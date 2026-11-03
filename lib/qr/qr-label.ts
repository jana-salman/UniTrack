
import { createEquipmentQrPayload } from "./qr-payload";

export interface EquipmentQrLabel {
  name: string;
  assetCode: string;
  qrPayload: string;
}

export function createEquipmentQrLabel(
  name: string,
  assetCode: string,
  itemId: string
): EquipmentQrLabel {
  const cleanedName = name.trim();
  const cleanedAssetCode = assetCode.trim();
  const qrPayload = createEquipmentQrPayload(itemId);

  if (cleanedName.length === 0) {
    throw new Error("Equipment name cannot be empty");
  }

  if (cleanedAssetCode.length === 0) {
    throw new Error("Equipment asset code cannot be empty");
  }

  return {
    name: cleanedName,
    assetCode: cleanedAssetCode,
    qrPayload,
  };
}
