// Pure handover rules: request validation, checklist completeness and
// reservation eligibility. No database or HTTP access.
import {
  HANDOVER_MAX_ROWS,
  HANDOVER_NOTES_MAX_LENGTH,
  HANDOVER_NOTE_REQUIRED_MESSAGE,
  hasRequiredHandoverNote,
  isConditionStatus,
  isProfileId,
  type ConfirmHandoverInput,
  type HandoverConditionInput,
} from "@unitrack/contracts";
import type { HandoverKitComponent } from "./equipment-port";

export class HandoverRuleError extends Error {}
/** A Missing component / Existing damage row without a note (approved wording). */
export class HandoverNoteRequiredError extends HandoverRuleError {}

/** Shape validation and normalization. Confirmation is checked separately. */
export function validateHandoverInput(value: unknown): ConfirmHandoverInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HandoverRuleError("Invalid handover information.");
  const body = value as Record<string, unknown>;
  if (body.studentConfirmed !== undefined && typeof body.studentConfirmed !== "boolean") throw new HandoverRuleError("Invalid student confirmation.");
  if (body.universityIdVerified !== undefined && typeof body.universityIdVerified !== "boolean") throw new HandoverRuleError("Invalid university ID check.");
  const rows = body.conditions;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > HANDOVER_MAX_ROWS) throw new HandoverRuleError("Record every checklist row.");
  const seen = new Set<string | null>();
  const conditions = rows.map((entry): HandoverConditionInput => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new HandoverRuleError("Invalid checklist row.");
    const row = entry as Record<string, unknown>;
    const id = row.kitComponentId;
    if (id !== null && !isProfileId(id)) throw new HandoverRuleError("Invalid kit component ID.");
    const componentId = id === null ? null : id.toLowerCase();
    if (seen.has(componentId)) throw new HandoverRuleError("Each row must be checked only once.");
    seen.add(componentId);
    if (typeof row.checked !== "boolean") throw new HandoverRuleError("Invalid checked value.");
    if (!isConditionStatus(row.conditionStatus)) throw new HandoverRuleError("Choose a valid condition.");
    if (row.notes !== undefined && row.notes !== null && typeof row.notes !== "string") throw new HandoverRuleError("Notes must be text.");
    const notes = typeof row.notes === "string" ? row.notes.trim() : "";
    if (notes.length > HANDOVER_NOTES_MAX_LENGTH) throw new HandoverRuleError("Notes are too long.");
    // Omitted, null, empty and whitespace-only notes all normalize to "".
    if (!hasRequiredHandoverNote({ conditionStatus: row.conditionStatus, notes })) throw new HandoverNoteRequiredError(HANDOVER_NOTE_REQUIRED_MESSAGE);
    return { kitComponentId: componentId, checked: row.checked, conditionStatus: row.conditionStatus, notes };
  });
  // Order carries no meaning; a stable order keeps retry fingerprints equal.
  conditions.sort((a, b) => { const left = a.kitComponentId ?? "", right = b.kitComponentId ?? ""; return left < right ? -1 : left > right ? 1 : 0; });
  if (typeof body.checklistVersion !== "string" || !/^[a-f0-9]{64}$/.test(body.checklistVersion)) throw new HandoverRuleError("Missing checklist version.");
  const acknowledged = body.acknowledgedMissing === undefined ? [] : body.acknowledgedMissing;
  if (!Array.isArray(acknowledged) || acknowledged.length > HANDOVER_MAX_ROWS
    || !acknowledged.every(id => id === null || isProfileId(id))) throw new HandoverRuleError("Invalid missing-item acknowledgement.");
  const acknowledgedMissing = [...new Set(acknowledged.map(id => (id === null ? null : id.toLowerCase())))]
    .sort((a, b) => { const left = a ?? "", right = b ?? ""; return left < right ? -1 : left > right ? 1 : 0; });
  return { universityIdVerified: body.universityIdVerified === true, studentConfirmed: body.studentConfirmed === true, checklistVersion: body.checklistVersion, acknowledgedMissing, conditions };
}

/**
 * PO decision A1 (confirmed by ZZ): handover may proceed with a missing
 * component only if it is disclosed, saved as missing with its note, and
 * included in the student's confirmation. The confirmation must list exactly
 * the rows recorded as missing in the same submission.
 */
export function confirmationCoversMissing(input: ConfirmHandoverInput): boolean {
  const missing = new Set(input.conditions.filter(row => row.conditionStatus === "missing").map(row => row.kitComponentId));
  const acknowledged = new Set(input.acknowledgedMissing ?? []);
  return missing.size === acknowledged.size && [...missing].every(id => acknowledged.has(id));
}

/**
 * Every handover records the MAIN ITEM explicitly (kitComponentId null) - the
 * kit itself or the non-kit item - plus, for kits, exactly one row per ACTIVE
 * kit component using actual component IDs. This is the pickup shape the
 * Return workflow compares against. Nothing is inferred: each row carries its
 * own assistant-chosen condition. Every row must be ticked; a missing
 * component is ticked AND marked missing.
 *
 * PO decision A1 (confirmed by ZZ): a component - required or not - may be
 * recorded Missing and handed over, provided the student's confirmation
 * includes it (see confirmationCoversMissing). isRequired is therefore not a
 * blocking rule here.
 */
export function validateHandoverChecklist(components: HandoverKitComponent[], conditions: HandoverConditionInput[]): void {
  const active = new Set(components.filter(component => component.isActive).map(component => component.id.toLowerCase()));
  const mainRows = conditions.filter(row => row.kitComponentId === null).length;
  if (active.size === 0) {
    if (conditions.length !== 1 || mainRows !== 1) throw new HandoverRuleError("Record the condition of the equipment item.");
  } else {
    if (mainRows !== 1) throw new HandoverRuleError("Record the condition of the main item as well as every component.");
    for (const row of conditions) {
      if (row.kitComponentId !== null && !active.has(row.kitComponentId)) throw new HandoverRuleError("A checked component does not belong to this equipment.");
    }
    if (conditions.length !== active.size + 1) throw new HandoverRuleError("Check every kit component listed for this equipment.");
  }
  if (conditions.some(row => row.checked !== true)) throw new HandoverRuleError("Tick every row after checking it.");
}

export interface EligibilityReservation { status: string; start_at: Date; end_at: Date }

export const MULTIPLE_ELIGIBLE_MESSAGE = "More than one reservation is eligible for this equipment right now. Ask staff to resolve the overlap.";
export const ACTIVE_LOAN_MESSAGE = "This equipment is already on loan.";

/**
 * SC eligibility rules (S2-09), evaluated on locked rows at plan time AND in the
 * final loan transaction:
 *   confirmed, start_at <= now < end_at, no active loan for the item, and the
 *   reservation is the ONLY confirmed reservation for that item whose window
 *   contains now. eligibleCount includes this reservation.
 */
export function checkFullEligibility(reservation: EligibilityReservation, now: Date, activeLoans: number, eligibleCount: number): void {
  checkHandoverEligibility(reservation, now);
  if (activeLoans > 0) throw new HandoverRuleError(ACTIVE_LOAN_MESSAGE);
  if (eligibleCount !== 1) throw new HandoverRuleError(MULTIPLE_ELIGIBLE_MESSAGE);
}

/**
 * Existing project rule (Return's active-pickup query): a reservation is in its
 * pickup period when status = confirmed and start_at <= now < end_at.
 */
export function checkHandoverEligibility(reservation: EligibilityReservation, now: Date): void {
  if (reservation.status !== "confirmed") throw new HandoverRuleError("Only confirmed reservations can be handed over.");
  if (now.getTime() < reservation.start_at.getTime()) throw new HandoverRuleError("The reservation pickup window has not started.");
  if (now.getTime() >= reservation.end_at.getTime()) throw new HandoverRuleError("The reservation pickup window has ended.");
}
