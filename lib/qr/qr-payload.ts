
export function createEquipmentQrPayload(itemId: string): string {
  const cleanedItemId = itemId.trim();

  if (cleanedItemId.length === 0) {
    throw new Error("Equipment ID cannot be empty");
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(cleanedItemId)) {
    throw new Error("Invalid equipment ID format");
  }

  return cleanedItemId;
}
