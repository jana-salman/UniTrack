import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyInternalToken } from "@unitrack/internal-auth";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getAuthenticatedProfile: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({ getAuthenticatedProfile: mocks.getAuthenticatedProfile }));
import { forwardReservation } from "@/lib/gateway/loans";

const profile = {
  id: "11111111-1111-4111-8111-111111111111", full_name: "Student",
  university_email: "student@university.example", role: "student" as const,
  lab_id: 12, is_active: true,
};
const itemId = "22222222-2222-4222-8222-222222222222";
const reservation = {
  id: "33333333-3333-4333-8333-333333333333", item_id: itemId,
  borrower_id: profile.id, lab_id: profile.lab_id,
  start_at: "2027-01-01T00:00:00.000Z", end_at: "2027-01-02T00:00:00.000Z", status: "confirmed",
};
const request = (origin = "http://web.test", body: unknown = { itemId, startAt: reservation.start_at, endAt: reservation.end_at }) => new Request("http://web.test/api/reservations", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAuthenticatedProfile.mockResolvedValue(profile);
  vi.stubEnv("LOANS_SERVICE_URL", "http://loans.test");
  vi.stubEnv("INTERNAL_JWT_SECRET", "public-dummy-test-secret-not-for-deployment");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Web reservation gateway", () => {
  it("forwards a browser request with a trusted identity and validates the saved response", async () => {
    const fetch = vi.fn(async (...args: [URL | RequestInfo, RequestInit?]) => { void args; return Response.json(reservation, { status: 201 }); });
    vi.stubGlobal("fetch", fetch);
    const response = await forwardReservation(request("http://web.test", { ...reservation, itemId, startAt: reservation.start_at, endAt: reservation.end_at, borrower_id: "99999999-9999-4999-8999-999999999999", lab_id: 99 }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(reservation);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("http://loans.test/reservations");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ itemId, borrower_id: "99999999-9999-4999-8999-999999999999", lab_id: 99 });
    const authorization = new Headers(init?.headers).get("authorization");
    const token = authorization?.replace(/^Bearer /, "");
    expect(token).toBeTruthy();
    expect(await verifyInternalToken(token, "public-dummy-test-secret-not-for-deployment")).toMatchObject({ sub: profile.id, role: "student", lab_id: profile.lab_id });
    expect(mocks.getAuthenticatedProfile).toHaveBeenCalledOnce();
  });

  it("preserves the exact restricted-equipment explanation from Loans", async () => {
    const error = "This item requires approval and cannot currently be reserved through UniTrack.";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error, code: "restricted_equipment" }, { status: 403 })));
    const response = await forwardReservation(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error, code: "restricted_equipment" });
  });

  it("rejects a cross-origin request and a non-student", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await forwardReservation(request("http://attacker.test"))).status).toBe(403);
    mocks.getAuthenticatedProfile.mockResolvedValueOnce({ ...profile, role: "lab_manager" });
    expect((await forwardReservation(request())).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed when Loans returns another borrower or lab", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...reservation, borrower_id: "99999999-9999-4999-8999-999999999999" }, { status: 201 })));
    const response = await forwardReservation(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Invalid service response.", code: "service_response" });
  });
});
