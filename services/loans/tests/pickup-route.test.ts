
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signInternalToken } from "@unitrack/internal-auth";

vi.mock("server-only", () => ({}));

vi.mock("../lib/reservations/pickup-query", () => ({
  getPickupMatch: vi.fn(),
}));

import { getPickupMatch } from "../lib/reservations/pickup-query";
import { GET } from "../app/reservations/pickup/route";

const secret = "public-dummy-test-secret-not-for-deployment";

const itemId = "11111111-1111-4111-8111-111111111111";
const reservationId = "22222222-2222-4222-8222-222222222222";
const loanId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";

const assistant = {
  kind: "user",
  sub: userId,
  role: "lab_assistant",
  lab_id: 5,
  rid: "pickup-test-request",
} as const;

const mockLookup = vi.mocked(getPickupMatch);

async function makeRequest(
  role: "lab_assistant" | "student" = "lab_assistant",
  id: string = itemId,
): Promise<Request> {
  const token = await signInternalToken(
    { ...assistant, role },
    secret,
  );

  return new Request(
    `http://loans.test/reservations/pickup?itemId=${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

beforeEach(() => {
  vi.stubEnv("INTERNAL_JWT_SECRET", secret);
  mockLookup.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /reservations/pickup", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await GET(
      new Request(
        `http://loans.test/reservations/pickup?itemId=${itemId}`,
      ),
    );

    expect(response.status).toBe(401);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("rejects users without the laboratory assistant role", async () => {
    const response = await GET(await makeRequest("student"));

    expect(response.status).toBe(403);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("rejects invalid equipment IDs", async () => {
    const response = await GET(
      await makeRequest("lab_assistant", "not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("returns confirmed reservations for the requesting lab", async () => {
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

    mockLookup.mockResolvedValue(match);

    const response = await GET(await makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(match);
    expect(mockLookup).toHaveBeenCalledWith(itemId, 5);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
  });

  it("returns an active loan when the item is borrowed", async () => {
    const match = {
      activeLoan: {
        id: loanId,
        dueDate: "2026-11-20T09:00:00.000Z",
      },
      confirmedReservations: [],
    };

    mockLookup.mockResolvedValue(match);

    const response = await GET(await makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(match);
  });

  it("handles equipment with no matching reservation or loan", async () => {
    mockLookup.mockResolvedValue({
      activeLoan: null,
      confirmedReservations: [],
    });

    const response = await GET(await makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      activeLoan: null,
      confirmedReservations: [],
    });
  });

  it("handles database failures without exposing details", async () => {
    mockLookup.mockRejectedValue(new Error("private database details"));

    const response = await GET(await makeRequest());
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).not.toContain("private database details");
  });
});
