
export const EQUIPMENT_STATUS_LABELS = {
  available: "Available",
  reserved: "Reserved",
  checked_out: "Borrowed",
  inspection_required: "Inspection Required",
  under_maintenance: "Under Repair",
  retired: "Retired",
  lost: "Lost",
  overdue: "Overdue",
} as const;

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

export type EquipmentStatus = keyof typeof EQUIPMENT_STATUS_LABELS;

export function getEquipmentStatusLabel(status: string): string {
  return (EQUIPMENT_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

export function isValidEquipmentStatus(
  status: string
): status is EquipmentStatus {
  return EQUIPMENT_STATUSES.some(
    (validStatus) => validStatus === status
  );
}