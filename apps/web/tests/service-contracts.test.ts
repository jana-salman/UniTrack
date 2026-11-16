import { describe, expect, it } from "vitest";
import {
  isCatalogueItem,
  isEquipmentItemSnapshot,
  isEquipmentStatusChangeResult,
  isLoanDueDate,
  isReturnDetails,
  isReturnOutcome,
  isReturnHistory,
  isOwnReturnProblem,
  isStudentReturnProblem,
} from "@unitrack/contracts";

const id = "550e8400-e29b-41d4-a716-446655440001";

describe("shared service response contracts", () => {
  it("rejects a history timing outcome that contradicts the persisted loan dates", () => {
    const returnedAt = "2026-11-16T12:00:00.000Z";
    const details = { loan: { id, item_id: id, borrower_id: id, reservation_id: null, lab_id: 7, borrowed_at: "2026-11-01T00:00:00.000Z", due_date: "2026-11-16T11:00:00.000Z", returned_at: returnedAt }, pickupConditions: [], returnHistory: { returnedAt, isLate: true, conditions: [] } };
    expect(isReturnDetails(details)).toBe(true);
    expect(isReturnDetails({ ...details, returnHistory: { ...details.returnHistory, isLate: false } })).toBe(false);
  });
  it("validates persisted history and rejects invalid condition/timestamp payloads", () => {
    const history = { returnedAt: "2026-11-16T12:00:00.000Z", isLate: false, conditions: [{ id, kitComponentId: null, conditionStatus: "damaged", notes: "Broken casing", recordedAt: "2026-11-16T12:00:00.000Z" }] };
    expect(isReturnHistory(history)).toBe(true);
    expect(isReturnHistory({ ...history, isLate: "false" })).toBe(false);
    expect(isReturnHistory({ ...history, conditions: [{ ...history.conditions[0], recordedAt: "bad-date" }] })).toBe(false);
    expect(isReturnHistory({ ...history, conditions: [{ ...history.conditions[0], conditionStatus: "repaired" }] })).toBe(false);
  });
  it("validates student problem projections and requires resolved/fallback label strings", () => {
    const own = { loanId: id, itemId: id, returnedAt: "2026-11-16T12:00:00.000Z", problems: [{ componentId: id, kind: "missing", notes: null }] };
    expect(isOwnReturnProblem(own)).toBe(true); expect(isStudentReturnProblem(own)).toBe(false);
    expect(isStudentReturnProblem({ ...own, itemName: "Kit", problems: [{ ...own.problems[0], label: "Charger" }] })).toBe(true);
    expect(isOwnReturnProblem({ ...own, problems: [{ ...own.problems[0], kind: "unknown" }] })).toBe(false);
    expect(isOwnReturnProblem({ ...own, problems: [{ ...own.problems[0], notes: {} }] })).toBe(false);
  });
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
