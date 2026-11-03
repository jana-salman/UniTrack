
import { describe, expect, it } from "vitest";

import {
  createEquipmentQrPayload,
  isValidEquipmentQrPayload,
} from "./qr-payload";

describe("Equipment QR payload validation", () => {
  const validUuid = "550e8400-e29b-41d4-a716-446655440000";

  describe("createEquipmentQrPayload", () => {
    it("returns a valid equipment UUID", () => {
      expect(createEquipmentQrPayload(validUuid)).toBe(validUuid);
    });

    it("removes surrounding whitespace", () => {
      expect(
        createEquipmentQrPayload(`  ${validUuid}  `)
      ).toBe(validUuid);
    });

    it("rejects an empty equipment ID", () => {
      expect(() => createEquipmentQrPayload("")).toThrow(
        "Equipment ID cannot be empty"
      );
    });

    it("rejects invalid equipment IDs", () => {
      expect(() => createEquipmentQrPayload("not-a-uuid")).toThrow(
        "Invalid equipment ID format"
      );
    });
  });

  describe("isValidEquipmentQrPayload", () => {
    it("accepts valid equipment UUIDs", () => {
      expect(isValidEquipmentQrPayload(validUuid)).toBe(true);
    });

    it("accepts UUIDs with surrounding whitespace", () => {
      expect(
        isValidEquipmentQrPayload(`  ${validUuid}  `)
      ).toBe(true);
    });

    it("rejects ordinary text", () => {
      expect(isValidEquipmentQrPayload("Digital Multimeter")).toBe(false);
    });

    it("rejects URLs", () => {
      expect(
        isValidEquipmentQrPayload(
          `https://unitrack.example/items/${validUuid}`
        )
      ).toBe(false);
    });

    it("rejects empty QR codes", () => {
      expect(isValidEquipmentQrPayload("")).toBe(false);
    });

    it("rejects malformed UUIDs", () => {
      expect(
        isValidEquipmentQrPayload(
          "550e8400-e29b-41d4-a716-invalid"
        )
      ).toBe(false);
    });
  });
});
