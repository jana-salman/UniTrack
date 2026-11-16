
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  getDatabasePool: () => ({
    query: mockQuery,
  }),
}));

import { getPickupMatch } from "../lib/reservations/pickup-query";

const itemId = "11111111-1111-4111-8111-111111111111";
const reservationId = "22222222-2222-4222-8222-222222222222";
const loanId = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  mockQuery.mockReset();
});

describe("getPickupMatch", () => {
  it("finds an active loan and confirmed reservations in the same lab", async () => {
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
        rows: [
          {
            id: reservationId,
            start_at: new Date("2026-11-17T09:00:00Z"),
            end_at: new Date("2026-11-17T11:00:00Z"),
          },
        ],
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
        },
      ],
    });

    expect(mockQuery).toHaveBeenCalledTimes(2);

    const [loanSql, loanParams] = mockQuery.mock.calls[0];
    const [reservationSql, reservationParams] = mockQuery.mock.calls[1];

    expect(loanSql).toMatch(/returned_at\s+IS\s+NULL/i);
    expect(loanSql).toMatch(/lab_id\s*=\s*\$2/i);
    expect(reservationSql).toMatch(/status\s*=\s*'confirmed'/i);
    expect(reservationSql).toMatch(/lab_id\s*=\s*\$2/i);
    expect(loanParams).toEqual([itemId, 5]);
    expect(reservationParams).toEqual([itemId, 5]);
  });

  it("returns empty results when there are no matches", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    expect(await getPickupMatch(itemId, 5)).toEqual({
      activeLoan: null,
      confirmedReservations: [],
    });
  });

  it("propagates database errors to the route error handler", async () => {
    mockQuery.mockRejectedValueOnce(new Error("Database unavailable"));

    await expect(getPickupMatch(itemId, 5)).rejects.toThrow(
      "Database unavailable",
    );
  });
});
