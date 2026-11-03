
import { test, expect } from "vitest";
import { createEquipmentQrPayload } from "./qr-payload";

const validId = "550e8400-e29b-41d4-a716-446655440000";

test("creates QR payload using equipment UUID", () => {
  expect(createEquipmentQrPayload(validId)).toBe(validId);
});

test("trims whitespace from equipment UUID", () => {
  expect(createEquipmentQrPayload(`  ${validId}  `)).toBe(validId);
});

test("rejects empty equipment IDs", () => {
  expect(() => createEquipmentQrPayload("   ")).toThrow(
    "Equipment ID cannot be empty"
  );
});

test("rejects invalid equipment UUIDs", () => {
  expect(() => createEquipmentQrPayload("UT-CAM-001")).toThrow(
    "Invalid equipment ID format"
  );
});

test("rejects URLs as QR payloads", () => {
  expect(() =>
    createEquipmentQrPayload(`https://unitrack.example/items/${validId}`)
  ).toThrow("Invalid equipment ID format");
});
