
import test from "node:test";
import assert from "node:assert/strict";
import {
  EQUIPMENT_STATUSES,
  isValidEquipmentStatus,
} from "./equipment-status.ts";

test("accepts all database equipment statuses", () => {
  for (const status of EQUIPMENT_STATUSES) {
    assert.equal(isValidEquipmentStatus(status), true);
  }
});

test("rejects invalid equipment statuses", () => {
  assert.equal(isValidEquipmentStatus("Borrowed"), false);
  assert.equal(isValidEquipmentStatus("broken"), false);
  assert.equal(isValidEquipmentStatus(""), false);
});
