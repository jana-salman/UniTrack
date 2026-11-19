
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  getDatabasePool: () => ({
    query: mockQuery,
  }),
}));

import {
  getPickupMatch,
  getPickupEligibility,
} from "../lib/reservations/pickup-query";

const itemId = "11111111-1111-4111-8111-111111111111";
const reservationId = "22222222-2222-4222-8222-222222222222";
const loanId = "33333333-3333-4333-8333-333333333333";
const secondReservationId = "55555555-5555-4555-8555-555555555555";

const startAt = new Date("2026-11-17T09:00:00Z");
const endAt = new Date("2026-11-17T11:00:00Z");

const reservation = {
  id: reservationId,
  start_at: startAt,
  end_at: endAt,
};

beforeEach(() => {
  mockQuery.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getPickupEligibility", () => {
  it("marks a future reservation as upcoming", () => {
    expect(
      getPickupEligibility(
        startAt,
        endAt,
        new Date("2026-11-17T08:00:00Z"),
      ),
    ).toBe("upcoming");
  });

  it("allows pickup exactly at the start time", () => {
    expect(
      getPickupEligibility(startAt, endAt, startAt),
    ).toBe("eligible");
  });

  it("allows pickup during the reservation window", () => {
    expect(
      getPickupEligibility(
        startAt,
        endAt,
        new Date("2026-11-17T10:00:00Z"),
      ),
    ).toBe("eligible");
  });

  it("marks a reservation as expired exactly at the end time", () => {
    expect(
      getPickupEligibility(startAt, endAt, endAt),
    ).toBe("expired");
  });

  it("marks a past reservation as expired", () => {
    expect(
      getPickupEligibility(
        startAt,
        endAt,
        new Date("2026-11-17T12:00:00Z"),
      ),
    ).toBe("expired");
  });
});

describe("getPickupMatch", () => {
  it("prioritizes an active loan over an eligible reservation", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: loanId,
            due_date: new Date("2026-11-20T09:00:00Z"),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [reservation],
      });

    const result = await getPickupMatch(itemId, 5);

    expect(result).toEqual({
      activeLoan: {
        id: loanId,
        dueDate: "2026-11-20T09:00:00.000Z",
      },
      confirmedReservations: [
        {
          id: reservationId,
          startAt: "2026-11-17T09:00:00.000Z",
          endAt: "2026-11-17T11:00:00.000Z",
          eligibility: "eligible",
        },
      ],
      multipleEligibleReservations: false,
      canHandover: false,
    });

    expect(mockQuery).toHaveBeenCalledTimes(2);

    const [loanSql, loanParams] = mockQuery.mock.calls[0];
    const [reservationSql, reservationParams] =
      mockQuery.mock.calls[1];

    expect(loanSql).toMatch(/returned_at\s+IS\s+NULL/i);
    expect(loanSql).toMatch(/lab_id\s*=\s*\$2/i);
    expect(reservationSql).toMatch(/status\s*=\s*'confirmed'/i);
    expect(reservationSql).toMatch(/lab_id\s*=\s*\$2/i);
    expect(reservationSql).toMatch(/ORDER BY start_at ASC/i);

    expect(loanParams).toEqual([itemId, 5]);
    expect(reservationParams).toEqual([itemId, 5]);
  });

  it("allows handover when exactly one reservation is eligible", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [reservation] });

    const result = await getPickupMatch(itemId, 5);

    expect(result.canHandover).toBe(true);
    expect(result.multipleEligibleReservations).toBe(false);
    expect(result.confirmedReservations[0].eligibility).toBe(
      "eligible",
    );
  });

  it("does not allow early pickup", async () => {
    vi.setSystemTime(new Date("2026-11-17T08:00:00Z"));

    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [reservation] });

    const result = await getPickupMatch(itemId, 5);

    expect(result.canHandover).toBe(false);
    expect(result.confirmedReservations[0].eligibility).toBe(
      "upcoming",
    );
  });

  it("does not allow handover for an expired reservation", async () => {
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));

    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [reservation] });

    const result = await getPickupMatch(itemId, 5);

    expect(result.canHandover).toBe(false);
    expect(result.confirmedReservations[0].eligibility).toBe(
      "expired",
    );
  });

  it("does not automatically select between multiple eligible reservations", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          reservation,
          {
            id: secondReservationId,
            start_at: new Date("2026-11-17T09:30:00Z"),
            end_at: new Date("2026-11-17T12:00:00Z"),
          },
        ],
      });

    const result = await getPickupMatch(itemId, 5);

    expect(result.confirmedReservations).toHaveLength(2);
    expect(result.multipleEligibleReservations).toBe(true);
    expect(result.canHandover).toBe(false);
  });

  it("allows handover with one eligible and one upcoming reservation", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          reservation,
          {
            id: secondReservationId,
            start_at: new Date("2026-11-17T13:00:00Z"),
            end_at: new Date("2026-11-17T15:00:00Z"),
          },
        ],
      });

    const result = await getPickupMatch(itemId, 5);

    expect(result.confirmedReservations[0].eligibility).toBe(
      "eligible",
    );
    expect(result.confirmedReservations[1].eligibility).toBe(
      "upcoming",
    );
    expect(result.multipleEligibleReservations).toBe(false);
    expect(result.canHandover).toBe(true);
  });

  it("returns empty results when there are no matches", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    expect(await getPickupMatch(itemId, 5)).toEqual({
      activeLoan: null,
      confirmedReservations: [],
      multipleEligibleReservations: false,
      canHandover: false,
    });
  });

  it("propagates database errors to the route error handler", async () => {
    mockQuery.mockRejectedValueOnce(
      new Error("Database unavailable"),
    );

    await expect(getPickupMatch(itemId, 5)).rejects.toThrow(
      "Database unavailable",
    );
  });
});
