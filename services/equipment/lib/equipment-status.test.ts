
import { test, expect } from "vitest";
import {
  EQUIPMENT_STATUSES,
  isValidEquipmentStatus,
} from "./equipment-status";

test("accepts all database equipment statuses", () => {
  for (const status of EQUIPMENT_STATUSES) {
    expect(isValidEquipmentStatus(status)).toBe(true);
  }
});

test("rejects invalid equipment statuses", () => {
  expect(isValidEquipmentStatus("Borrowed")).toBe(false);
  expect(isValidEquipmentStatus("broken")).toBe(false);
  expect(isValidEquipmentStatus("")).toBe(false);
});
