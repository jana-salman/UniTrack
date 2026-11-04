
import { test, expect } from "vitest";
import { createEquipmentQrLabel } from "./qr-label";

const validId = "550e8400-e29b-41d4-a716-446655440000";

test("creates a label with name, asset code, and UUID payload", () => {
  const result = createEquipmentQrLabel(
    "Canon Camera",
    "UT-CAM-001",
    validId
  );

  expect(result).toEqual({
    name: "Canon Camera",
    assetCode: "UT-CAM-001",
    qrPayload: validId,
  });
});

test("trims equipment name and asset code", () => {
  const result = createEquipmentQrLabel(
    "  Canon Camera  ",
    "  UT-CAM-001  ",
    validId
  );

  expect(result.name).toBe("Canon Camera");
  expect(result.assetCode).toBe("UT-CAM-001");
});

test("rejects empty equipment names", () => {
  expect(() =>
    createEquipmentQrLabel("   ", "UT-CAM-001", validId)
  ).toThrow("Equipment name cannot be empty");
});

test("rejects empty asset codes", () => {
  expect(() =>
    createEquipmentQrLabel("Canon Camera", "   ", validId)
  ).toThrow("Equipment asset code cannot be empty");
});

test("rejects invalid UUIDs", () => {
  expect(() =>
    createEquipmentQrLabel("Canon Camera", "UT-CAM-001", "invalid-id")
  ).toThrow("Invalid equipment ID format");
});

test("keeps the asset code separate from the QR payload", () => {
  const result = createEquipmentQrLabel(
    "Canon Camera",
    "UT-CAM-001",
    validId
  );

  expect(result.assetCode).toBe("UT-CAM-001");
  expect(result.qrPayload).toBe(validId);
  expect(result.qrPayload).not.toBe(result.assetCode);
});
