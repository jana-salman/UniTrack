import { describe, expect, it } from "vitest";
import {
  isCatalogueItem,
  isEquipmentItemSnapshot,
  isEquipmentStatusChangeResult,
  isLoanDueDate,
  isReturnDetails,
  isReturnOutcome,
} from "@unitrack/contracts";

const id = "550e8400-e29b-41d4-a716-446655440001";

describe("shared service response contracts", () => {
  it("accepts the implemented Equipment and Loans wire shapes", () => {
    expect(isCatalogueItem({ id, assetCode: "EQ-1", name: "Camera", category: "Cameras", status: "Borrowed", expectedReturn: null })).toBe(true);
    expect(isEquipmentItemSnapshot({ id, name: "Camera", lab_id: 7, status: "checked_out", extra: true })).toBe(true);
    expect(isEquipmentStatusChangeResult({ itemId: id, status: "available", changed: true })).toBe(true);
    expect(isLoanDueDate({ itemId: id, dueDate: "2030-01-01T00:00:00.000Z" })).toBe(true);
    expect(isReturnOutcome({ loanId: id, returnedAt: "2030-01-01T00:00:00.000Z", status: "available", isLate: false })).toBe(true);
  });

  it("rejects malformed success payloads before they cross service boundaries", () => {
    expect(isCatalogueItem({ id, assetCode: "EQ-1", name: "Camera" })).toBe(false);
    expect(isEquipmentItemSnapshot({ id, name: "Camera", lab_id: 7, status: "invented" })).toBe(false);
    expect(isEquipmentStatusChangeResult({ itemId: id, status: "available", changed: "yes" })).toBe(false);
    expect(isLoanDueDate({ itemId: id, dueDate: "not-a-date" })).toBe(false);
    expect(isReturnDetails({ loan: {}, pickupConditions: [] })).toBe(false);
    expect(isReturnOutcome({ loanId: id, returnedAt: "not-a-date", status: "available", isLate: false })).toBe(false);
  });
});
