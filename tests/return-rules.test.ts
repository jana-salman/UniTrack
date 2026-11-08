import { describe, expect, it } from "vitest";

import { determineReturnOutcome } from "../lib/returns/rules";
import type { ReturnLoan } from "../lib/returns/types";

const loan: ReturnLoan = {
  id: "loan-1",
  item_id: "item-1",
  borrower_id: "student-1",
  reservation_id: "reservation-1",
  lab_id: 1,
  borrowed_at: new Date("2026-11-08T08:00:00Z"),
  due_date: new Date("2026-11-10T12:00:00Z"),
  returned_at: null,
};

describe("return rules", () => {
  it("makes a clean return available", () => {
    const result = determineReturnOutcome(
      loan,
      new Date("2026-11-10T10:00:00Z"),
      false,
      false,
    );

    expect(result).toEqual({
      status: "available",
      isLate: false,
    });
  });

  it("reserves a clean item when another pickup period is active", () => {
    const result = determineReturnOutcome(
      loan,
      new Date("2026-11-10T10:00:00Z"),
      false,
      true,
    );

    expect(result.status).toBe("reserved");
  });

  it("requires inspection when a return has a problem", () => {
    const result = determineReturnOutcome(
      loan,
      new Date("2026-11-10T10:00:00Z"),
      true,
      false,
    );

    expect(result.status).toBe("inspection_required");
  });

  it("keeps a problem item unavailable even with a waiting pickup", () => {
    const result = determineReturnOutcome(
      loan,
      new Date("2026-11-10T10:00:00Z"),
      true,
      true,
    );

    expect(result.status).toBe("inspection_required");
  });

  it("records a return after the due time as late", () => {
    const result = determineReturnOutcome(
      loan,
      new Date("2026-11-10T12:00:01Z"),
      false,
      false,
    );

    expect(result.isLate).toBe(true);
  });

  it("does not mark a return exactly at the due time as late", () => {
    const result = determineReturnOutcome(
      loan,
      new Date("2026-11-10T12:00:00Z"),
      false,
      false,
    );

    expect(result.isLate).toBe(false);
  });

  it("rejects a second return of the same loan", () => {
    expect(() =>
      determineReturnOutcome(
        {
          ...loan,
          returned_at: new Date("2026-11-09T10:00:00Z"),
        },
        new Date("2026-11-10T10:00:00Z"),
        false,
        false,
      ),
    ).toThrow("This loan has already been returned.");
  });

  it("rejects a return before the handover", () => {
    expect(() =>
      determineReturnOutcome(
        loan,
        new Date("2026-11-08T07:00:00Z"),
        false,
        false,
      ),
    ).toThrow("The return cannot be before the handover.");
  });

  it("rejects an invalid return date", () => {
    expect(() =>
      determineReturnOutcome(
        loan,
        new Date("invalid"),
        false,
        false,
      ),
    ).toThrow("Invalid loan or return date.");
  });
});