
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

export function isValidEquipmentStatus(
  status: string
): status is EquipmentStatus {
  return EQUIPMENT_STATUSES.some((validStatus) => validStatus === status);
}
