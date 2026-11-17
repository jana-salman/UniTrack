// Pure handover rules: request validation, checklist completeness and
// reservation eligibility. No database or HTTP access.
import {
  HANDOVER_MAX_ROWS,
  HANDOVER_NOTES_MAX_LENGTH,
  isConditionStatus,
  isProfileId,
  type ConfirmHandoverInput,
  type HandoverConditionInput,
} from "@unitrack/contracts";
import type { HandoverKitComponent } from "./equipment-port";

export class HandoverRuleError extends Error {}

/** Shape validation and normalization. Confirmation is checked separately. */
export function validateHandoverInput(value: unknown): ConfirmHandoverInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HandoverRuleError("Invalid handover information.");
  const body = value as Record<string, unknown>;
  if (body.studentConfirmed !== undefined && typeof body.studentConfirmed !== "boolean") throw new HandoverRuleError("Invalid student confirmation.");
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
    return { kitComponentId: componentId, checked: row.checked, conditionStatus: row.conditionStatus, notes };
  });
  // Order carries no meaning; a stable order keeps retry fingerprints equal.
  conditions.sort((a, b) => { const left = a.kitComponentId ?? "", right = b.kitComponentId ?? ""; return left < right ? -1 : left > right ? 1 : 0; });
  return { studentConfirmed: body.studentConfirmed === true, conditions };
}

/**
 * Kits: exactly one row per ACTIVE kit component, using actual component IDs.
 * Non-kit equipment (no active components): exactly one main-item row (null),
 * which is the pickup shape the existing Return workflow compares against.
 * Every row must be ticked; a missing component is ticked AND marked missing.
 *
 * UNRESOLVED ASSUMPTION (awaiting Product Owner): checkout is allowed even when a
 * REQUIRED component is missing, because TC-3.4 needs the missing record saved
 * and condition records require a loan. isRequired is deliberately not checked
 * here; change this rule only after the PO answers (docs/handover-s2-09.md).
 */
export function validateHandoverChecklist(components: HandoverKitComponent[], conditions: HandoverConditionInput[]): void {
  const active = new Set(components.filter(component => component.isActive).map(component => component.id.toLowerCase()));
  if (active.size === 0) {
    if (conditions.length !== 1 || conditions[0].kitComponentId !== null) throw new HandoverRuleError("Record the condition of the equipment item.");
  } else {
    for (const row of conditions) {
      if (row.kitComponentId === null || !active.has(row.kitComponentId)) throw new HandoverRuleError("A checked component does not belong to this equipment.");
    }
    if (conditions.length !== active.size) throw new HandoverRuleError("Check every kit component listed for this equipment.");
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
