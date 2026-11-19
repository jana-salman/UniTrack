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
 * Review correction (PR #24): a row recorded as Missing component or Existing
 * damage must say what is missing or damaged. Omitted, empty and
 * whitespace-only notes are rejected by the page AND by Loans (input and every
 * stored plan). Good and Needs attention keep notes optional.
 */
export const HANDOVER_NOTE_REQUIRED_CONDITIONS: readonly ConditionStatus[] = ["missing", "damaged"];
export const HANDOVER_NOTE_REQUIRED_MESSAGE = "Add a note to every row marked Missing component or Existing damage.";
export function handoverNoteRequired(status: unknown): boolean {
  return HANDOVER_NOTE_REQUIRED_CONDITIONS.includes(status as ConditionStatus);
}
/** False only when the row's condition needs a note and it has no visible text. */
export function hasRequiredHandoverNote(row: { conditionStatus: unknown; notes?: unknown }): boolean {
  return !handoverNoteRequired(row.conditionStatus) || (typeof row.notes === "string" && row.notes.trim().length > 0);
}

/**
 * kitComponentId is null for the MAIN ITEM (always required: the kit itself or
 * the non-kit item) or an actual kit_components.id for each active component.
 * This is the pickup shape Return compares against (main row + components).
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
  /**
   * PO decision (JS): the assistant physically checked the student's university
   * ID card against the reservation's borrower. Separate from the student's
   * confirmation; both are required. No ID number, upload or photo is collected.
   */
  universityIdVerified: boolean;
  studentConfirmed: boolean;
  /**
   * PO decision A1: rows recorded as missing (kitComponentId, null = main item)
   * that were listed in the student's on-screen confirmation. Must equal the
   * set of missing rows, otherwise the confirmation does not cover them.
   */
  acknowledgedMissing?: (string | null)[];
  /** Version of the Equipment checklist shown to the assistant/student. */
  checklistVersion: string;
  conditions: HandoverConditionInput[];
}

/** One kit component as served by Equipment GET /items/:id/components. */
export interface ChecklistComponentSource { id: string; component_name: string; is_active: boolean; is_required: boolean }
/**
 * Canonical text of the checklist the page shows. Web and Loans hash this
 * (SHA-256 hex) from Equipment data; a different value means kit membership or
 * component data changed after the checklist was loaded.
 */
export function canonicalChecklist(itemId: string, components: readonly ChecklistComponentSource[]): string {
  const rows = components
    .map(c => [c.id.toLowerCase(), c.component_name, c.is_active, c.is_required] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify({ v: 1, item: itemId.toLowerCase(), rows });
}
export function isChecklistComponentSource(value: unknown): value is ChecklistComponentSource {
  return isRecord(value) && isUuid(value.id) && typeof value.component_name === "string"
    && typeof value.is_active === "boolean" && typeof value.is_required === "boolean";
}

/** Users GET /profiles/:id/borrower: same-lab, staff-only identity status. */
export interface BorrowerVerification { id: string; full_name: string; role: string; lab_id: number; is_active: boolean }
export function isBorrowerVerification(value: unknown): value is BorrowerVerification {
  return isRecord(value) && isUuid(value.id) && typeof value.full_name === "string"
    && typeof value.role === "string" && Number.isSafeInteger(value.lab_id) && (value.lab_id as number) > 0
    && typeof value.is_active === "boolean";
}
/**
 * PO decision (JS): the borrower must be an ACTIVE STUDENT of the reservation's
 * lab whose profile id is the reservation's borrower_id.
 */
export function isEligibleBorrower(value: BorrowerVerification, borrowerId: string, labId: number): boolean {
  return value.id.toLowerCase() === borrowerId.toLowerCase() && value.lab_id === labId
    && value.role === "student" && value.is_active === true;
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
  universityIdVerifiedAt: string | null;
  returnedAt: string | null;
  pickupConditions: PickupCondition[];
}
export type HandoverPendingState = "planned" | "applied" | "compensating" | "compensated";
/** A confirmed attempt that has not finished. Recovery uses the stored plan. */
export interface HandoverPending {
  state: HandoverPendingState;
  startedAt: string;
  /** True when the signed-in assistant may finish or undo it now. */
  recoverableByYou: boolean;
}
export interface HandoverDetails {
  reservation: HandoverReservationWire;
  handover: CompletedHandoverWire | null;
  pending: HandoverPending | null;
}
export interface InterruptedHandover { reservationId: string; itemId: string; state: HandoverPendingState; startedAt: string; recoverableByYou: boolean }
export interface HandoverOutcome {
  loanId: string;
  reservationId: string;
  itemId: string;
  borrowerId: string;
  borrowedAt: string;
  dueDate: string;
  studentConfirmedAt: string;
  /** When the assistant recorded the physical university-ID check. */
  universityIdVerifiedAt: string;
  status: "checked_out";
}

function isPickupCondition(value: unknown): value is PickupCondition {
  return isRecord(value) && isUuid(value.id)
    && (value.kit_component_id === null || isUuid(value.kit_component_id))
    && isConditionStatus(value.condition_status)
    && (value.notes === null || typeof value.notes === "string");
}

export function isHandoverDetails(value: unknown): value is HandoverDetails {
  if (!isRecord(value) || !isRecord(value.reservation) || !(value.pending === null || isHandoverPending(value.pending))) return false;
  const r = value.reservation;
  const reservation = isUuid(r.id) && isUuid(r.item_id) && isUuid(r.borrower_id)
    && Number.isSafeInteger(r.lab_id) && (r.lab_id as number) > 0
    && isDateString(r.start_at) && isDateString(r.end_at) && typeof r.status === "string";
  if (!reservation) return false;
  if (value.handover === null) return true;
  const h = value.handover;
  return isRecord(h) && isUuid(h.loanId) && isDateString(h.borrowedAt) && isDateString(h.dueDate)
    && (h.studentConfirmedAt === null || isDateString(h.studentConfirmedAt))
    && (h.universityIdVerifiedAt === null || isDateString(h.universityIdVerifiedAt))
    && (h.returnedAt === null || isDateString(h.returnedAt))
    && Array.isArray(h.pickupConditions) && h.pickupConditions.every(isPickupCondition);
}

const PENDING_STATES = ["planned", "applied", "compensating", "compensated"];
export function isHandoverPending(value: unknown): value is HandoverPending {
  return isRecord(value) && typeof value.state === "string" && PENDING_STATES.includes(value.state)
    && isDateString(value.startedAt) && typeof value.recoverableByYou === "boolean";
}
export function isInterruptedHandover(value: unknown): value is InterruptedHandover {
  return isRecord(value) && isUuid(value.reservationId) && isUuid(value.itemId) && typeof value.state === "string"
    && PENDING_STATES.includes(value.state) && isDateString(value.startedAt) && typeof value.recoverableByYou === "boolean";
}

export function isHandoverOutcome(value: unknown): value is HandoverOutcome {
  return isRecord(value) && isUuid(value.loanId) && isUuid(value.reservationId)
    && isUuid(value.itemId) && isUuid(value.borrowerId)
    && isDateString(value.borrowedAt) && isDateString(value.dueDate)
    && isDateString(value.studentConfirmedAt) && isDateString(value.universityIdVerifiedAt) && value.status === "checked_out";
}

// Approved handover wire vocabulary; merged into LOANS_ERROR_CONTRACT.
export const HANDOVER_ERROR_MESSAGES = [
  "Invalid reservation ID.", "Reservation not found.",
  "Invalid handover information. Check every component.",
  HANDOVER_NOTE_REQUIRED_MESSAGE,
  "The student must confirm the handover before it can be completed.",
  "Check the student's university ID card in person and tick the ID check before completing the handover.",
  "The borrower must be an active student in this lab, matching the reservation.",
  "The student's confirmation must include every item recorded as missing. Ask the student to confirm again.",
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
  "Record the condition of the main item as well as every component.",
  "The equipment's component list changed. Reload the checklist and check it again.",
  "The reservation changed during handover. Reload and check it again.",
  "The borrower's university profile could not be verified, so handover is not allowed.",
  "The borrower's identity cannot be checked right now. Try again shortly.",
  "The equipment is checked out but the handover is not finished. Use Finish interrupted handover to complete or undo it.",
  "Another handover for this reservation is unfinished. Use Finish interrupted handover first.",
  "Only the assistant who started this handover can finish or undo it. Ask them, or ask a lab manager to reconcile.",
  "There is no unfinished handover for this reservation.",
  "The interrupted handover was undone and the equipment restored. Start a new handover with the student present.",
  "Tick every row after checking it.",
  "A handover is already in progress. Retry the same information later.",
  "Handover information or confirming user differs from the recorded attempt.",
  "Equipment rejected the handover. Verify its status before retrying.",
  "The handover result needs verification. Retry the same handover information or ask staff to reconcile it.",
  "Handover records were not saved. Equipment was restored. Retry the same handover information.",
  "Handover is not available yet: reservations cannot be marked fulfilled. Nothing was changed. Ask an administrator.",
] as const;
export const HANDOVER_ERROR_CODES = [
  "invalid_reservation", "reservation_not_found", "invalid_handover",
  "student_confirmation_required", "id_verification_required", "handover_conflict",
  "handover_state_uncertain", "handover_rolled_back",
  "borrower_unverified", "borrower_unavailable", "handover_incomplete", "handover_not_pending",
  "reservation_fulfillment_unavailable",
] as const;
