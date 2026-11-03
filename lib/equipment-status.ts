// Database status values (from JS's Supabase tables) -> labels shown in UniTrack.
// SC and SN can reuse this file so everyone spells the statuses the same way.
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

export type EquipmentStatus = keyof typeof EQUIPMENT_STATUS_LABELS;

export function getEquipmentStatusLabel(status: string): string {
  return (EQUIPMENT_STATUS_LABELS as Record<string, string>)[status] ?? status;
}