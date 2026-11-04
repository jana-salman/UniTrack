
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createEquipmentQrPayload(itemId: string): string {
  const cleanedItemId = itemId.trim();

  if (cleanedItemId.length === 0) {
    throw new Error("Equipment ID cannot be empty");
  }

  if (!UUID_PATTERN.test(cleanedItemId)) {
    throw new Error("Invalid equipment ID format");
  }

  return cleanedItemId;
}

export function isValidEquipmentQrPayload(
  scannedText: string
): boolean {
  try {
    createEquipmentQrPayload(scannedText);
    return true;
  } catch {
    return false;
  }
}
