// Browser-facing handover view built by the Web gateway (S2-09). Pure types,
// labels and a guard; safe to import from client components.
import { isConditionStatus, type ConditionStatus } from "@unitrack/contracts";

// Same labels as Equipment's stored status values (checked_out = Borrowed).
export const EQUIPMENT_STATUS_LABELS: Record<string, string> = {
  available: "Available", reserved: "Reserved", checked_out: "Borrowed",
  inspection_required: "Inspection Required", under_maintenance: "Under Repair",
  retired: "Retired", lost: "Lost", overdue: "Overdue",
};
export function statusLabel(status: string): string {
  return EQUIPMENT_STATUS_LABELS[status] ?? status;
}

export interface HandoverView {
  reservation: { id: string; itemId: string; borrowerId: string; startAt: string; endAt: string; status: string };
  handover: {
    loanId: string; borrowedAt: string; dueDate: string; studentConfirmedAt: string | null; returnedAt: string | null;
    pickupConditions: { id: string; kitComponentId: string | null; conditionStatus: ConditionStatus; notes: string | null }[];
  } | null;
  pendingOperation: boolean;
  /** null when Equipment could not be read: the checklist must not be guessed. */
  equipment: { name: string; assetCode: string | null; status: string } | null;
  /** Active kit components; [] for non-kit equipment; null when unavailable. */
  components: { id: string; name: string; required: boolean }[] | null;
  borrower: { name: string | null };
  partialData?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isDate = (value: unknown) => isText(value) && Number.isFinite(Date.parse(value));

export function isHandoverView(value: unknown): value is HandoverView {
  if (!isRecord(value) || !isRecord(value.reservation) || typeof value.pendingOperation !== "boolean" || !isRecord(value.borrower)) return false;
  const r = value.reservation;
  if (![r.id, r.itemId, r.borrowerId, r.status].every(isText) || !isDate(r.startAt) || !isDate(r.endAt)) return false;
  if (value.borrower.name !== null && !isText(value.borrower.name)) return false;
  if (value.equipment !== null && !(isRecord(value.equipment) && isText(value.equipment.name) && isText(value.equipment.status) && (value.equipment.assetCode === null || isText(value.equipment.assetCode)))) return false;
  if (value.components !== null && !(Array.isArray(value.components) && value.components.every(c => isRecord(c) && isText(c.id) && isText(c.name) && typeof c.required === "boolean"))) return false;
  if (value.partialData !== undefined && typeof value.partialData !== "boolean") return false;
  if (value.handover === null) return true;
  const h = value.handover;
  return isRecord(h) && isText(h.loanId) && isDate(h.borrowedAt) && isDate(h.dueDate)
    && (h.studentConfirmedAt === null || isDate(h.studentConfirmedAt)) && (h.returnedAt === null || isDate(h.returnedAt))
    && Array.isArray(h.pickupConditions) && h.pickupConditions.every(p => isRecord(p) && isText(p.id)
      && (p.kitComponentId === null || isText(p.kitComponentId)) && isConditionStatus(p.conditionStatus) && (p.notes === null || isText(p.notes)));
}
