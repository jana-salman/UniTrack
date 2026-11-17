
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
const secondReservationId = "55555555-5555-4555-8555-555555555555";

const assistant = {
  kind: "user",
  sub: userId,
  role: "lab_assistant",
  lab_id: 5,
  rid: "pickup-test-request",
} as const;

const mockLookup = vi.mocked(getPickupMatch);

const reservation = {
  id: reservationId,
  startAt: "2026-11-17T09:00:00.000Z",
  endAt: "2026-11-17T11:00:00.000Z",
  eligibility: "eligible" as const,
};

const emptyMatch = {
  activeLoan: null,
  confirmedReservations: [],
  multipleEligibleReservations: false,
  canHandover: false,
};

async function makeRequest(
  role: "lab_assistant" | "student" | "professor" | "lab_manager" =
    "lab_assistant",
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

  it.each(["student", "professor", "lab_manager"] as const)(
    "rejects reservation matching for the %s role",
    async (role) => {
      const response = await GET(await makeRequest(role));

      expect(response.status).toBe(403);
      expect(mockLookup).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid equipment IDs", async () => {
    const response = await GET(
      await makeRequest("lab_assistant", "not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("returns an eligible reservation for the requesting lab", async () => {
    const match = {
      ...emptyMatch,
      confirmedReservations: [reservation],
      canHandover: true,
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

  it.each(["upcoming", "expired"] as const)(
    "returns a %s reservation without enabling handover",
    async (eligibility) => {
      const match = {
        ...emptyMatch,
        confirmedReservations: [
          { ...reservation, eligibility },
        ],
      };

      mockLookup.mockResolvedValue(match);

      const response = await GET(await makeRequest());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(match);
    },
  );

  it("returns an active loan without enabling handover", async () => {
    const match = {
      ...emptyMatch,
      activeLoan: {
        id: loanId,
        dueDate: "2026-11-20T09:00:00.000Z",
      },
      confirmedReservations: [reservation],
    };

    mockLookup.mockResolvedValue(match);

    const response = await GET(await makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(match);
  });

  it("returns multiple eligible reservations without choosing one", async () => {
    const match = {
      ...emptyMatch,
      confirmedReservations: [
        reservation,
        {
          ...reservation,
          id: secondReservationId,
        },
      ],
      multipleEligibleReservations: true,
    };

    mockLookup.mockResolvedValue(match);

    const response = await GET(await makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(match);
  });

  it("handles equipment with no matching reservation or loan", async () => {
    mockLookup.mockResolvedValue(emptyMatch);

    const response = await GET(await makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(emptyMatch);
  });

  it("handles database failures without exposing details", async () => {
    mockLookup.mockRejectedValue(
      new Error("private database details"),
    );

    const response = await GET(await makeRequest());
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).not.toContain("private database details");
  });
});
