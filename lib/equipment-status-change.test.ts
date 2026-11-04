
import { test, expect } from "vitest";
import { validateStatusChange } from "./equipment-status-change";

const validId = "550e8400-e29b-41d4-a716-446655440000";

test("accepts valid status change requests", () => {
  const result = validateStatusChange(
    validId,
    "under_maintenance",
    " Needs repair "
  );

  expect(result).toEqual({
    itemId: validId,
    newStatus: "under_maintenance",
    reason: "Needs repair",
  });
});

test("rejects empty equipment IDs", () => {
  expect(() =>
    validateStatusChange("  ", "available")
  ).toThrow("Equipment ID cannot be empty");
});

test("rejects invalid UUIDs", () => {
  expect(() =>
    validateStatusChange("camera123", "available")
  ).toThrow("Invalid equipment ID format");
});

test("rejects invalid equipment statuses", () => {
  expect(() =>
    validateStatusChange(validId, "broken")
  ).toThrow("Invalid equipment status");
});

test("allows an optional reason", () => {
  const result = validateStatusChange(validId, "available");

  expect(result.reason).toBeUndefined();
});
