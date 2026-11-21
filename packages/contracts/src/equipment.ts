const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export const EQUIPMENT_STATUSES = [
  "available",
  "reserved",
  "checked_out",
  "inspection_required",
  "under_maintenance",
  "retired",
  "lost",
  "overdue",
] as const;

export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export function isEquipmentStatus(value: unknown): value is EquipmentStatus {
  return typeof value === "string" && EQUIPMENT_STATUSES.includes(value as EquipmentStatus);
}

export interface CatalogueItem {
  id: string;
  assetCode: string;
  name: string;
  category: string;
  status: string;
  expectedReturn: string | null;
  isRestricted?: boolean;
  isKit?: boolean;
  canReserve?: boolean;
}

export function isCatalogueItem(value: unknown): value is CatalogueItem {
  if (!isRecord(value)) return false;
  return isUuid(value.id)
    && typeof value.assetCode === "string"
    && typeof value.name === "string"
    && typeof value.category === "string"
    && typeof value.status === "string"
    && (value.isRestricted === undefined || typeof value.isRestricted === "boolean")
    && (value.isKit === undefined || typeof value.isKit === "boolean")
    && (value.canReserve === undefined || typeof value.canReserve === "boolean")
    && (value.expectedReturn === null
      || (typeof value.expectedReturn === "string" && Number.isFinite(Date.parse(value.expectedReturn))));
}

export interface EquipmentItemSnapshot {
  id: string;
  name: string;
  lab_id: number;
  status: EquipmentStatus;
  is_restricted?: boolean;
}

export function isEquipmentItemSnapshot(value: unknown): value is EquipmentItemSnapshot {
  if (!isRecord(value)) return false;
  return isUuid(value.id)
    && typeof value.name === "string"
    && Number.isSafeInteger(value.lab_id)
    && (value.lab_id as number) > 0
    && isEquipmentStatus(value.status)
    && (value.is_restricted === undefined || typeof value.is_restricted === "boolean");
}

export interface EquipmentComponentSnapshot {
  id: string;
  component_name: string;
}

export function isEquipmentComponentSnapshot(value: unknown): value is EquipmentComponentSnapshot {
  return isRecord(value) && isUuid(value.id) && typeof value.component_name === "string";
}

export interface EquipmentStatusChangeResult {
  itemId: string;
  status: EquipmentStatus;
  changed: boolean;
}

export function isEquipmentStatusChangeResult(value: unknown): value is EquipmentStatusChangeResult {
  return isRecord(value)
    && isUuid(value.itemId)
    && isEquipmentStatus(value.status)
    && typeof value.changed === "boolean";
}

// Approved error vocabulary; domain validation remains in Equipment.
export const EQUIPMENT_ERROR_CONTRACT = {
  "messages": [
    "Equipment database is not configured.",
    "Equipment authentication is not configured.",
    "Equipment database schema is not ready.",
    "Equipment database access is not configured.",
    "Equipment database is unavailable.",
    "Category data must be an object.",
    "Category name is required.",
    "Category name must not exceed 100 characters.",
    "Description must be a string.",
    "Equipment data must be an object.",
    "Equipment name must contain 1 to 150 characters.",
    "Asset code must contain 1 to 50 characters.",
    "A valid category ID is required.",
    "A valid laboratory ID is required.",
    "Description must be text.",
    "Serial number must be at most 100 characters.",
    "Invalid equipment condition.",
    "is_restricted must be true or false.",
    "Could not load the catalogue",
    "Invalid equipment data.",
    "An equipment item with this asset code already exists.",
    "Invalid category or related database record.",
    "Could not create equipment.",
    "Could not load categories",
    "A category with this name already exists.",
    "Could not create category.",
    "Unable to retrieve equipment.",
    "Invalid equipment ID.",
    "Invalid JSON body.",
    "Equipment not found or access denied.",
    "Invalid category ID.",
    "Could not update equipment.",
    "Kit data must be an object.",
    "Choose a valid list of distinct component items.",
    "Invalid kit information.",
    "A kit or component with that identifier already exists.",
    "Every tracked component must be a different item in your laboratory.",
    "Kit components must be available, unrestricted equipment.",
    "Kit main item and kit must belong to the same laboratory",
    "Invalid kit or component.",
    "Could not process the kit request.",
    "Invalid kit ID.",
    "Kit not found.",
    "That item is already a component of this kit.",
    "Invalid component item.",
    "Could not add this component.",
    "Choose a valid component item.",
    "Invalid kit or component ID.",
    "Active kit component not found.",
    "Could not remove this component.",
    "Invalid JSON body",
    "Invalid request body",
    "Invalid status or reason",
    "Only Lab Managers can retire equipment",
    "Invalid equipment ID format",
    "Equipment ID cannot be empty",
    "Invalid equipment status",
    "Equipment item not found or access denied",
    "Internal server error",
    "Equipment status changed. Reload before trying again.",
    "Idempotency key was already used for a different status change",
    "Invalid expectedStatus",
    "Invalid idempotency key",
    "Invalid item IDs. Maximum batch size is 100.",
    "Sign in is required.",
    "You do not have permission to perform this action.",
    "Enter a valid equipment identifier (maximum 100 characters)."
  ],
  "codes": [
    "equipment_not_configured", "equipment_schema_not_ready", "equipment_database_access", "equipment_database_unavailable",
    "equipment_status_conflict", "kit_conflict", "invalid_kit", "duplicate_component", "invalid_component", "kit_unavailable",
    "idempotency_key_conflict",
    "unauthenticated",
    "insufficient_role"
  ]
} as const;
