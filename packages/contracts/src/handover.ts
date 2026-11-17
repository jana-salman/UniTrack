// C430PRJCT-40 / S2-09 handover wire contracts. Pure DTOs and guards only.
import { isConditionStatus, type ConditionStatus, type PickupCondition } from "./returns.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
function isDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Confirmed labels. Stored values are the existing condition_records values. */
export const HANDOVER_CONDITION_LABELS: Record<ConditionStatus, string> = {
  good: "Good",
  damaged: "Existing damage",
  missing: "Missing component",
  unknown: "Needs attention",
};

export const HANDOVER_NOTES_MAX_LENGTH = 1000;
export const HANDOVER_MAX_ROWS = 100;

/**
 * kitComponentId is an actual kit_components.id for kits, or null for the
 * main item of non-kit equipment (the shape Return already expects).
 * checked means the assistant reviewed the row; it is NOT a claim that the
 * component is present. A missing component is checked and marked missing.
 */
export interface HandoverConditionInput {
  kitComponentId: string | null;
  checked: boolean;
  conditionStatus: ConditionStatus;
  notes?: string;
}
export interface ConfirmHandoverInput {
  studentConfirmed: boolean;
  conditions: HandoverConditionInput[];
}

export interface HandoverReservationWire {
  id: string;
  item_id: string;
  borrower_id: string;
  lab_id: number;
  start_at: string;
  end_at: string;
  status: string;
}
export interface CompletedHandoverWire {
  loanId: string;
  borrowedAt: string;
  dueDate: string;
  studentConfirmedAt: string | null;
  returnedAt: string | null;
  pickupConditions: PickupCondition[];
}
export interface HandoverDetails {
  reservation: HandoverReservationWire;
  handover: CompletedHandoverWire | null;
  /** A confirmed attempt exists but did not finish (retry the same checklist). */
  pendingOperation: boolean;
}
export interface HandoverOutcome {
  loanId: string;
  reservationId: string;
  itemId: string;
  borrowerId: string;
  borrowedAt: string;
  dueDate: string;
  studentConfirmedAt: string;
  status: "checked_out";
}

function isPickupCondition(value: unknown): value is PickupCondition {
  return isRecord(value) && isUuid(value.id)
    && (value.kit_component_id === null || isUuid(value.kit_component_id))
    && isConditionStatus(value.condition_status)
    && (value.notes === null || typeof value.notes === "string");
}

export function isHandoverDetails(value: unknown): value is HandoverDetails {
  if (!isRecord(value) || !isRecord(value.reservation) || typeof value.pendingOperation !== "boolean") return false;
  const r = value.reservation;
  const reservation = isUuid(r.id) && isUuid(r.item_id) && isUuid(r.borrower_id)
    && Number.isSafeInteger(r.lab_id) && (r.lab_id as number) > 0
    && isDateString(r.start_at) && isDateString(r.end_at) && typeof r.status === "string";
  if (!reservation) return false;
  if (value.handover === null) return true;
  const h = value.handover;
  return isRecord(h) && isUuid(h.loanId) && isDateString(h.borrowedAt) && isDateString(h.dueDate)
    && (h.studentConfirmedAt === null || isDateString(h.studentConfirmedAt))
    && (h.returnedAt === null || isDateString(h.returnedAt))
    && Array.isArray(h.pickupConditions) && h.pickupConditions.every(isPickupCondition);
}

export function isHandoverOutcome(value: unknown): value is HandoverOutcome {
  return isRecord(value) && isUuid(value.loanId) && isUuid(value.reservationId)
    && isUuid(value.itemId) && isUuid(value.borrowerId)
    && isDateString(value.borrowedAt) && isDateString(value.dueDate)
    && isDateString(value.studentConfirmedAt) && value.status === "checked_out";
}

// Approved handover wire vocabulary; merged into LOANS_ERROR_CONTRACT.
export const HANDOVER_ERROR_MESSAGES = [
  "Invalid reservation ID.", "Reservation not found.",
  "Invalid handover information. Check every component.",
  "The student must confirm the handover before it can be completed.",
  "Only confirmed reservations can be handed over.",
  "The reservation pickup window has not started.",
  "The reservation pickup window has ended.",
  "This reservation has already been handed over.",
  "This equipment is already on loan.",
  "More than one reservation is eligible for this equipment right now. Ask staff to resolve the overlap.",
  "Only reserved or available equipment can be handed over.",
  "Check every kit component listed for this equipment.",
  "A checked component does not belong to this equipment.",
  "Record the condition of the equipment item.",
  "Tick every row after checking it.",
  "A handover is already in progress. Retry the same information later.",
  "Handover information or confirming user differs from the recorded attempt.",
  "Equipment rejected the handover. Verify its status before retrying.",
  "The handover result needs verification. Retry the same handover information or ask staff to reconcile it.",
  "Handover records were not saved. Equipment was restored. Retry the same handover information.",
] as const;
export const HANDOVER_ERROR_CODES = [
  "invalid_reservation", "reservation_not_found", "invalid_handover",
  "student_confirmation_required", "handover_conflict",
  "handover_state_uncertain", "handover_rolled_back",
] as const;
