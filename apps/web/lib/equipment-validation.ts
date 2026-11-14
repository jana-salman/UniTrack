export const EQUIPMENT_CONDITIONS = [
  "good",
  "damaged",
  "missing",
  "unknown",
] as const;

export type EquipmentCondition =
  (typeof EQUIPMENT_CONDITIONS)[number];

export type CreateEquipmentInput = {
  asset_code: string;
  name: string;
  description?: string | null;
  serial_number?: string | null;
  category_id: number;
  lab_id: number;
  condition: EquipmentCondition;
  is_restricted: boolean;
};


export function validateCreateEquipmentInput(input: unknown): string[] {
  const errors: string[] = [];

  // Make sure the request contains an object.
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return ["Equipment data must be an object."];
  }

  const item = input as Record<string, unknown>;

  // Validate equipment name.
  if (
    typeof item.name !== "string" ||
    item.name.trim().length === 0 ||
    item.name.length > 150
  ) {
    errors.push("Equipment name must contain 1 to 150 characters.");
  }

  // Validate asset code.
  if (
    typeof item.asset_code !== "string" ||
    item.asset_code.trim().length === 0 ||
    item.asset_code.length > 50
  ) {
    errors.push("Asset code must contain 1 to 50 characters.");
  }

  // Validate category ID.
  if (
    !Number.isInteger(item.category_id) ||
    (item.category_id as number) <= 0
  ) {
    errors.push("A valid category ID is required.");
  }

  // Validate laboratory ID.
  if (
    !Number.isInteger(item.lab_id) ||
    (item.lab_id as number) <= 0
  ) {
    errors.push("A valid laboratory ID is required.");
  }

  // Validate optional description.
  if (
    item.description != null &&
    typeof item.description !== "string"
  ) {
    errors.push("Description must be text.");
  }

  // Validate optional serial number.
  if (
    item.serial_number != null &&
    (typeof item.serial_number !== "string" ||
      item.serial_number.length > 100)
  ) {
    errors.push("Serial number must be at most 100 characters.");
  }

  // Validate equipment condition.
  if (
    item.condition !== undefined &&
    !EQUIPMENT_CONDITIONS.some((c) => c === item.condition)
  ) {
    errors.push("Invalid equipment condition.");
  }

  // Validate whether the item is restricted.
  if (
    item.is_restricted !== undefined &&
    typeof item.is_restricted !== "boolean"
  ) {
    errors.push("is_restricted must be true or false.");
  }

  return errors;
}

export function validateUpdateEquipmentInput(input: unknown): string[] {
  const errors: string[] = [];

  // Make sure the request contains an object.
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return ["Equipment data must be an object."];
  }

  const item = input as Record<string, unknown>;

  // Validate equipment name.
  if (
    typeof item.name !== "string" ||
    item.name.trim().length === 0 ||
    item.name.length > 150
  ) {
    errors.push("Equipment name must contain 1 to 150 characters.");
  }

  // Validate category ID.
  if (
    !Number.isInteger(item.category_id) ||
    (item.category_id as number) <= 0
  ) {
    errors.push("A valid category ID is required.");
  }

  // Validate optional description.
  if (
    item.description != null &&
    typeof item.description !== "string"
  ) {
    errors.push("Description must be text.");
  }

  // Validate optional serial number.
  if (
    item.serial_number != null &&
    (typeof item.serial_number !== "string" ||
      item.serial_number.length > 100)
  ) {
    errors.push("Serial number must be at most 100 characters.");
  }

  // Validate equipment condition.
  if (
    !EQUIPMENT_CONDITIONS.some(
      (condition) => condition === item.condition
    )
  ) {
    errors.push("Invalid equipment condition.");
  }

  // Validate restricted status.
  if (typeof item.is_restricted !== "boolean") {
    errors.push("is_restricted must be true or false.");
  }

  return errors;
}