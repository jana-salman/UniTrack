
import test from "node:test";
import assert from "node:assert/strict";
import { validateStatusChange } from "./equipment-status-change";

const validId = "550e8400-e29b-41d4-a716-446655440000";

test("accepts valid status change requests", () => {
  const result = validateStatusChange(
    validId,
    "under_maintenance",
    " Needs repair "
  );

  assert.deepEqual(result, {
    itemId: validId,
    newStatus: "under_maintenance",
    reason: "Needs repair",
  });
});

test("rejects empty equipment IDs", () => {
  assert.throws(
    () => validateStatusChange("  ", "available"),
    /Equipment ID cannot be empty/
  );
});

test("rejects invalid UUIDs", () => {
  assert.throws(
    () => validateStatusChange("camera123", "available"),
    /Invalid equipment ID format/
  );
});

test("rejects invalid equipment statuses", () => {
  assert.throws(
    () => validateStatusChange(validId, "broken"),
    /Invalid equipment status/
  );
});

test("allows an optional reason", () => {
  const result = validateStatusChange(validId, "available");

  assert.equal(result.reason, undefined);
});
