import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), equipmentHttp: vi.fn(), createReservation: vi.fn() }));
vi.mock("../lib/authorization", () => ({ requireUser: mocks.requireUser }));
vi.mock("../lib/equipment-http", () => ({ equipmentHttp: mocks.equipmentHttp }));
vi.mock("../lib/reservations/create", () => ({ createReservation: mocks.createReservation }));
import { POST } from "../app/reservations/route";
import { LoansError } from "../lib/errors";

const actor = { kind: "user", sub: "11111111-1111-4111-8111-111111111111", role: "student", lab_id: 7, rid: "test-request" } as const;
const body = { itemId: "22222222-2222-4222-8222-222222222222", startAt: "2027-01-01T00:00:00.000Z", endAt: "2027-01-02T00:00:00.000Z" };
const request = (payload: unknown) => new Request("http://loans.test/reservations", { method: "POST", body: JSON.stringify(payload) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue(actor);
  mocks.equipmentHttp.mockReturnValue({ getReservationItem: vi.fn(), getReservationComponents: vi.fn() });
  mocks.createReservation.mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333", item_id: body.itemId, borrower_id: actor.sub, lab_id: actor.lab_id, start_at: body.startAt, end_at: body.endAt, status: "confirmed" });
});

describe("POST /reservations", () => {
  it("returns the confirmed reservation and uses the verified actor's equipment port", async () => {
    const response = await POST(request(body));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ item_id: body.itemId, borrower_id: actor.sub, lab_id: actor.lab_id, status: "confirmed" });
    expect(mocks.requireUser).toHaveBeenCalledWith(expect.any(Request), ["student"]);
    expect(mocks.equipmentHttp).toHaveBeenCalledWith(actor);
    expect(mocks.createReservation).toHaveBeenCalledWith(body, actor, mocks.equipmentHttp.mock.results[0].value);
  });

  it("rejects an unauthorized identity before touching Equipment or the database", async () => {
    mocks.requireUser.mockRejectedValueOnce(new LoansError(401, "unauthenticated", "Sign in is required."));
    const response = await POST(request(body));
    expect(response.status).toBe(401);
    expect(mocks.equipmentHttp).not.toHaveBeenCalled();
    expect(mocks.createReservation).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(new Request("http://loans.test/reservations", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(mocks.createReservation).not.toHaveBeenCalled();
  });
});
