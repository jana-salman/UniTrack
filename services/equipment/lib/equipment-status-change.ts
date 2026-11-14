
import {
  isValidEquipmentStatus,
  type EquipmentStatus,
} from "./equipment-status";

export interface StatusChangeInput {
  itemId: string;
  newStatus: EquipmentStatus;
  reason?: string;
}

export function validateStatusChange(
  itemId: string,
  newStatus: string,
  reason?: string
): StatusChangeInput {
  const cleanedItemId = itemId.trim();

  if (cleanedItemId.length === 0) {
    throw new Error("Equipment ID cannot be empty");
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(cleanedItemId)) {
    throw new Error("Invalid equipment ID format");
  }

  if (!isValidEquipmentStatus(newStatus)) {
    throw new Error("Invalid equipment status");
  }

  return {
    itemId: cleanedItemId,
    newStatus,
    reason: reason?.trim() || undefined,
  };
}
