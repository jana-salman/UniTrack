import type { CreateEquipmentInput } from "./equipment-validation";

export function buildCreateEquipmentQuery(
  item: CreateEquipmentInput,
  createdBy: string | null
) {
  const text = `
    INSERT INTO public.equipment_items (
      asset_code,
      name,
      description,
      serial_number,
      category_id,
      lab_id,
      condition,
      is_restricted,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING
      id,
      asset_code,
      name,
      description,
      serial_number,
      category_id,
      lab_id,
      condition,
      is_restricted,
      status,
      created_at,
      updated_at;
  `;

  const values = [
    item.asset_code.trim(),
    item.name.trim(),
    item.description?.trim() || null,
    item.serial_number?.trim() || null,
    item.category_id,
    item.lab_id,
    item.condition ?? "unknown",
    item.is_restricted ?? false,
    createdBy,
  ];

  return { text, values };
}


export type UpdateEquipmentInput = Pick<
  CreateEquipmentInput,
  | "name"
  | "description"
  | "serial_number"
  | "category_id"
  | "condition"
  | "is_restricted"
>;

export function buildUpdateEquipmentQuery(
  itemId: string,
  labId: number,
  item: UpdateEquipmentInput
) {
  const text = `
    UPDATE public.equipment_items
    SET
      name = $1,
      description = $2,
      serial_number = $3,
      category_id = $4,
      condition = $5,
      is_restricted = $6
    WHERE id = $7
      AND lab_id = $8
    RETURNING
      id,
      asset_code,
      name,
      description,
      serial_number,
      category_id,
      lab_id,
      condition,
      is_restricted,
      status,
      updated_at;
  `;

  const values = [
    item.name.trim(),
    item.description?.trim() || null,
    item.serial_number?.trim() || null,
    item.category_id,
    item.condition ?? "unknown",
    item.is_restricted ?? false,
    itemId,
    labId,
  ];

  return { text, values };
}
