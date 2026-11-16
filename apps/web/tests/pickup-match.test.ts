
import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  loans: vi.fn(),
  equipment: vi.fn(),
}));

vi.mock("@/lib/gateway/loans", () => ({
  trustedIdentity: mocks.identity,
  callLoans: mocks.loans,
}));

vi.mock("@/lib/gateway/call-service", () => ({
  createServiceCaller: vi.fn(() => mocks.equipment),
}));

import { GET } from "@/app/api/reservations/pickup/route";

const itemId = "11111111-1111-4111-8111-111111111111";
const reservationId = "22222222-2222-4222-8222-222222222222";
const loanId = "33333333-3333-4333-8333-333333333333";

const identity = {
  kind: "user" as const,
  sub: "44444444-4444-4444-8444-444444444444",
  role: "lab_assistant" as const,
  lab_id: 5,
  rid: "pickup-web-test",
};

const equipment = {
  id: itemId,
  name: "Camera",
  lab_id: 5,
  status: "available",
};

const emptyMatch = {
  activeLoan: null,
  confirmedReservations: [],
};

function request(id: string = itemId): Request {
  return new Request(
    `http://web.test/api/reservations/pickup?itemId=${encodeURIComponent(id)}`,
  );
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

beforeEach(() => {
  mocks.identity.mockReset().mockResolvedValue(identity);
  mocks.equipment.mockReset().mockResolvedValue(json(equipment));
  mocks.loans.mockReset().mockResolvedValue(json(emptyMatch));

  vi.stubEnv("EQUIPMENT_SERVICE_URL", "http://equipment.test");
  vi.stubEnv("LOANS_SERVICE_URL", "http://loans.test");
  vi.stubEnv("INTERNAL_JWT_SECRET", "dummy-test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/reservations/pickup", () => {
  it("returns equipment with a confirmed reservation", async () => {
    const match = {
      activeLoan: null,
      confirmedReservations: [
        {
          id: reservationId,
          startAt: "2026-11-17T09:00:00.000Z",
          endAt: "2026-11-17T11:00:00.000Z",
        },
      ],
    };

    mocks.loans.mockResolvedValueOnce(json(match));

    const response = await GET(request());

    expect(response.status).toBe(200);

    expect(await response.json()).toEqual({
      equipment: {
        id: itemId,
        name: "Camera",
        status: "available",
      },
      ...match,
    });

    expect(mocks.equipment).toHaveBeenCalledWith(
      `/items/${itemId}`,
      identity,
    );

    expect(mocks.loans).toHaveBeenCalledWith(
      `/reservations/pickup?itemId=${itemId}`,
      identity,
    );

    expect(response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
  });

  it("returns an active loan for borrowed equipment", async () => {
    mocks.equipment.mockResolvedValueOnce(
      json({ ...equipment, status: "checked_out" }),
    );

    mocks.loans.mockResolvedValueOnce(
      json({
        activeLoan: {
          id: loanId,
          dueDate: "2026-11-20T09:00:00.000Z",
        },
        confirmedReservations: [],
      }),
    );

    const response = await GET(request());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.activeLoan.id).toBe(loanId);
    expect(data.equipment.status).toBe("checked_out");
  });

  it("handles equipment with no matching reservation", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(emptyMatch);
  });

  it("rejects unauthorized users before calling services", async () => {
    mocks.identity.mockResolvedValueOnce({
      ...identity,
      role: "student",
    });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mocks.equipment).not.toHaveBeenCalled();
    expect(mocks.loans).not.toHaveBeenCalled();
  });

  it("rejects invalid equipment IDs", async () => {
    const response = await GET(request("invalid-id"));

    expect(response.status).toBe(400);
    expect(mocks.equipment).not.toHaveBeenCalled();
    expect(mocks.loans).not.toHaveBeenCalled();
  });

  it("rejects equipment belonging to another lab", async () => {
    mocks.equipment.mockResolvedValueOnce(
      json({ ...equipment, lab_id: 9 }),
    );

    const response = await GET(request());

    expect(response.status).toBe(502);
    expect(mocks.loans).not.toHaveBeenCalled();
  });

  it("rejects invalid Equipment Service responses", async () => {
    mocks.equipment.mockResolvedValueOnce(
      json({ id: itemId, name: "Camera" }),
    );

    const response = await GET(request());

    expect(response.status).toBe(502);
    expect(mocks.loans).not.toHaveBeenCalled();
  });

  it("handles Equipment Service errors", async () => {
    mocks.equipment.mockResolvedValueOnce(
      json({ error: "Unavailable" }, 503),
    );

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(mocks.loans).not.toHaveBeenCalled();
  });

  it("rejects malformed Loans Service responses", async () => {
    mocks.loans.mockResolvedValueOnce(
      json({
        activeLoan: null,
        confirmedReservations: "invalid",
      }),
    );

    const response = await GET(request());

    expect(response.status).toBe(502);
  });

  it("handles Loans Service failures", async () => {
    mocks.loans.mockResolvedValueOnce(
      json({ error: "Unavailable" }, 503),
    );

    const response = await GET(request());

    expect(response.status).toBe(503);
  });
});
