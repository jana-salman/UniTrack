export function createEquipmentQrPayload(identifier: string): string {
  const cleanedIdentifier = identifier.trim();

  if (cleanedIdentifier.length === 0) {
    throw new Error("Equipment identifier cannot be empty");
  }

  return cleanedIdentifier;
}