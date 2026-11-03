
import { createEquipmentQrPayload } from "./qr-payload";

export interface EquipmentQrLabel {
  name: string;
  assetCode: string;
  qrPayload: string;
}

export function createEquipmentQrLabel(
  name: string,
  assetCode: string
): EquipmentQrLabel {
  const cleanedName = name.trim();
  const cleanedAssetCode = createEquipmentQrPayload(assetCode);

  if (cleanedName.length === 0) {
    throw new Error("Equipment name cannot be empty");
  }

  return {
    name: cleanedName,
    assetCode: cleanedAssetCode,
    qrPayload: cleanedAssetCode,
  };
}
