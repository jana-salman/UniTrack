import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  canonicalChecklist,
  isConditionStatus,
  isHandoverOutcome,
  type ConfirmHandoverInput,
  type HandoverConditionInput,
  type HandoverOutcome,
  type UserIdentity,
} from "@unitrack/contracts";
import { getDatabasePool } from "../db";
import { LoansError, handoverUncertain } from "../errors";
import type { BorrowerPort } from "../users-http";
import type { HandoverEquipmentPort, HandoverKitComponent } from "./equipment-port";
import { HandoverRuleError, checkFullEligibility, validateHandoverChecklist, validateHandoverInput } from "./rules";
import { saveHandoverRecordsInTransaction } from "./save-records";

type PriorStatus = "reserved" | "available";
export interface HandoverOperation {
  fingerprint: string; key: string; attempt: number; actor: string;
  previous: PriorStatus; result: HandoverOutcome;
  state: "planned" | "applied" | "compensating" | "compensated" | "completed";
  /** Normalized checklist and its Equipment version: recovery never needs the browser. */
  conditions: HandoverConditionInput[];
  checklistVersion: string;
}
interface ReservationRow {
  id: string; item_id: string; borrower_id: string; lab_id: number;
  start_at: Date; end_at: Date; status: string; handover_operation: HandoverOperation | null;
}
export interface HandoverPorts { equipment: HandoverEquipmentPort; users: BorrowerPort }

const conflict = (message: string) => new LoansError(409, "handover_conflict", message);
const incomplete = () => new LoansError(503, "handover_incomplete", "The equipment is checked out but the handover is not finished. Use Finish interrupted handover to complete or undo it.");
const starterOnly = () => conflict("Only the assistant who started this handover can finish or undo it. Ask them, or ask a lab manager to reconcile.");
const COMPONENTS_CHANGED = "The equipment's component list changed. Reload the checklist and check it again.";
const CHECKOUT_REASON = "Handed over after pickup checklist and student confirmation.";
const UNDO_REASON = "Compensate failed handover record transaction.";

/** SHA-256 of the canonical checklist; the Web gateway computes it identically. */
export function checklistVersionOf(itemId: string, components: HandoverKitComponent[]): string {
  const canonical = canonicalChecklist(itemId, components.map(c => ({ id: c.id, component_name: c.name, is_active: c.isActive, is_required: c.isRequired })));
  return createHash("sha256").update(canonical).digest("hex");
}

function validOperation(op: HandoverOperation, reservationId: string): boolean {
  return typeof op.fingerprint === "string" && /^[a-f0-9]{64}$/.test(op.fingerprint)
    && typeof op.key === "string" && /^handover:[a-f0-9-]{36}$/.test(op.key)
    && Number.isSafeInteger(op.attempt) && op.attempt >= 0 && op.attempt < Number.MAX_SAFE_INTEGER
    && typeof op.actor === "string" && ["reserved", "available"].includes(op.previous)
    && ["planned", "applied", "compensating", "compensated", "completed"].includes(op.state)
    && isHandoverOutcome(op.result) && op.result.reservationId === reservationId
    && typeof op.checklistVersion === "string" && /^[a-f0-9]{64}$/.test(op.checklistVersion)
    && Array.isArray(op.conditions) && op.conditions.length > 0 && op.conditions.every(row => !!row
      && (row.kitComponentId === null || typeof row.kitComponentId === "string")
      && row.checked === true && isConditionStatus(row.conditionStatus) && typeof row.notes === "string");
}

// The shared Equipment adapter words its errors for returns; keep the handover
// wording and approved codes. Unknown failures are uncertain, never "no change".
function equipmentFailure(error: unknown): LoansError {
  if (error instanceof LoansError) {
    if (error.code === "equipment_rejected") {
      return error.status === 404
        ? new LoansError(404, "equipment_missing", "Equipment item not found.")
        : new LoansError(409, "equipment_rejected", "Equipment rejected the handover. Verify its status before retrying.");
    }
    if (error.code === "return_state_uncertain") return handoverUncertain();
    return error;
  }
  return handoverUncertain();
}
async function remote<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) { throw equipmentFailure(error); }
}

type Mode = { kind: "submit"; raw: unknown } | { kind: "recover" };

/** Browser submission: checklist + explicit student confirmation. */
export function confirmHandover(reservationId: string, raw: unknown, actor: UserIdentity, ports: HandoverPorts): Promise<HandoverOutcome> {
  return runHandover(reservationId, actor, ports, { kind: "submit", raw });
}
/** Finish or undo an interrupted handover from its DURABLE plan (no form data). */
export function recoverHandover(reservationId: string, actor: UserIdentity, ports: HandoverPorts): Promise<HandoverOutcome> {
  return runHandover(reservationId, actor, ports, { kind: "recover" });
}

/**
 * Request-driven handover Saga (same protocol as the reviewed return Saga):
 * 1. Student confirmation and checklist shape are enforced before ANY database
 *    or Equipment access.
 * 2. Under a session advisory lock: SC eligibility on locked rows, borrower
 *    verified through Users, Equipment state and the component-list version;
 *    then COMMIT a durable plan (including the checklist) before Equipment
 *    changes.
 * 3. Equipment checkout with a stable key (expectedStatus = observed prior
 *    status). Lost responses are replayed with the SAME key.
 * 4. After checkout, borrower and component version are re-verified over HTTP,
 *    then one local transaction re-verifies eligibility on locked rows and
 *    inserts the loan and every pickup record.
 * 5. Definitive ineligibility or an acknowledged rollback permits only the
 *    ownership-guarded undo. Unavailable services after checkout leave a
 *    recoverable 'applied' plan (handover_incomplete), never a false success.
 */
async function runHandover(reservationId: string, actor: UserIdentity, ports: HandoverPorts, mode: Mode): Promise<HandoverOutcome> {
  const { equipment, users } = ports;
  if (actor.kind !== "user" || actor.role !== "lab_assistant") throw new LoansError(403, "forbidden", "Permission denied.");
  reservationId = reservationId.toLowerCase();
  let input: ConfirmHandoverInput | null = null;
  let fingerprint: string | null = null;
  if (mode.kind === "submit") {
    try { input = validateHandoverInput(mode.raw); }
    catch { throw new LoansError(400, "invalid_handover", "Invalid handover information. Check every component."); }
    // TC-3.7: without explicit student confirmation nothing is read or written.
    if (!input.studentConfirmed) throw new LoansError(400, "student_confirmation_required", "The student must confirm the handover before it can be completed.");
    fingerprint = createHash("sha256").update(JSON.stringify({ actor: actor.sub, reservationId, input })).digest("hex");
  }
  const lockKey = "loans:handover:" + reservationId;

  const client = await getDatabasePool().connect();
  let locked = false, transaction = false, broken = false;
  async function begin() { await client.query("BEGIN"); transaction = true; }
  async function commit() {
    // COMMIT failure is ambiguous even if a later ROLLBACK succeeds.
    try { await client.query("COMMIT"); transaction = false; }
    catch { broken = true; throw handoverUncertain(); }
  }
  async function rollback(): Promise<boolean> {
    if (!transaction) return true;
    try { await client.query("ROLLBACK"); transaction = false; return true; }
    catch { broken = true; return false; }
  }
  async function persist(op: HandoverOperation) {
    const saved = await client.query("update public.reservations set handover_operation = $1::jsonb where id = $2 and lab_id = $3 returning id", [JSON.stringify(op), reservationId, actor.lab_id]);
    if (saved.rows.length !== 1) throw handoverUncertain();
  }
  async function selectReservation(): Promise<ReservationRow | undefined> {
    return (await client.query<ReservationRow>(
      "select id, item_id, borrower_id, lab_id, start_at, end_at, status, handover_operation from public.reservations where id = $1 and lab_id = $2 for update",
      [reservationId, actor.lab_id])).rows[0];
  }
  /**
   * SC eligibility on LOCKED state, inside the caller's transaction. The item
   * advisory lock serializes handovers for DIFFERENT reservations of the same
   * item (the per-reservation session lock cannot), so the active-loan and
   * single-eligible-reservation counts cannot change between check and insert
   * through this service. Other reservation writers are NOT covered (see docs).
   */
  async function lockedEligibility(row: ReservationRow, now: Date): Promise<void> {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", ["loans:handover:item:" + row.item_id]);
    const active = await client.query<{ count: number }>("select count(*)::int as count from public.loans where item_id = $1 and returned_at is null", [row.item_id]);
    const eligible = await client.query<{ count: number }>("select count(*)::int as count from public.reservations where item_id = $1 and status = 'confirmed' and start_at <= $2 and end_at > $2", [row.item_id, now]);
    try { checkFullEligibility(row, now, active.rows[0]?.count ?? 0, eligible.rows[0]?.count ?? 0); }
    catch (error) { throw conflict(error instanceof HandoverRuleError ? error.message : "Only confirmed reservations can be handed over."); }
  }
  async function loanExists(loanId: string): Promise<boolean> {
    const found = await client.query("select id from public.loans where reservation_id = $1 or id = $2", [reservationId, loanId]);
    return found.rows.length > 0;
  }
  async function componentsVersion(itemId: string): Promise<{ components: HandoverKitComponent[]; version: string }> {
    const components = await remote(() => equipment.getKitComponents(itemId, actor.lab_id));
    return { components, version: checklistVersionOf(itemId, components) };
  }

  try {
    const lock = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtextextended($1, 0)) as locked", [lockKey]);
    if (!lock.rows[0]?.locked) throw conflict("A handover is already in progress. Retry the same information later.");
    locked = true;
    await begin();
    const reservation = await selectReservation();
    if (!reservation) throw new LoansError(404, "reservation_not_found", "Reservation not found.");
    let op = reservation.handover_operation;
    if (op && !validOperation(op, reservationId)) throw handoverUncertain();
    const existing = await client.query<{ id: string }>("select id from public.loans where reservation_id = $1", [reservationId]);
    const existingLoan = existing.rows[0]?.id ?? null;
    if (op?.state === "completed") {
      if (existingLoan !== op.result.loanId) throw handoverUncertain();
      // Exact replay (double click/retry) or recovery of a finished handover.
      if (mode.kind === "submit" && op.fingerprint !== fingerprint) throw conflict("This reservation has already been handed over.");
      await commit();
      return op.result;
    }
    if (existingLoan) throw conflict("This reservation has already been handed over.");

    if (mode.kind === "recover") {
      if (!op) throw new LoansError(404, "handover_not_pending", "There is no unfinished handover for this reservation.");
      if (op.state === "compensated") throw conflict("The interrupted handover was undone and the equipment restored. Start a new handover with the student present.");
      // Equipment binds a keyed operation to the assistant who started it.
      // A confirmed checkout ('applied') needs no Equipment write to finish.
      if (op.state !== "applied" && op.actor !== actor.sub) throw starterOnly();
    } else if (op && op.fingerprint !== fingerprint) {
      // A confirmed undo means Equipment holds nothing for the old plan, so a
      // new student confirmation may replace it. Anything else must finish first.
      if (op.state !== "compensated") throw conflict("Another handover for this reservation is unfinished. Use Finish interrupted handover first.");
      op = null;
    }

    if (!op || op.state === "compensated") {
      // Equipment is known NOT to hold our checkout here, so every check may
      // refuse safely before contacting Equipment.
      const now = new Date();
      await lockedEligibility(reservation, now);
      await users.verifyBorrower(reservation.borrower_id);
      const item = await remote(() => equipment.getItem(reservation.item_id, actor.lab_id));
      if (!item || item.id !== reservation.item_id || item.labId !== actor.lab_id) throw new LoansError(404, "equipment_missing", "Equipment item not found.");
      // No existing code moves an item to reserved when a reservation starts
      // (only Return does, for an active pickup window), and data-model.md says
      // reservations do not change physical status. A confirmed in-window
      // reservation is therefore the authority; available is accepted too.
      // UNRESOLVED ASSUMPTION pending the reservations owner (docs/handover-s2-09.md).
      if (item.status !== "reserved" && item.status !== "available") throw conflict("Only reserved or available equipment can be handed over.");
      const { components, version } = await componentsVersion(reservation.item_id);
      const checklist = op ? op.conditions : input!.conditions;
      if (version !== (op ? op.checklistVersion : input!.checklistVersion)) throw conflict(COMPONENTS_CHANGED);
      try { validateHandoverChecklist(components, checklist); }
      catch (error) { throw conflict(error instanceof HandoverRuleError ? error.message : "Check every kit component listed for this equipment."); }
      if (!op) {
        const accepted = now.toISOString();
        op = {
          fingerprint: fingerprint!, key: "handover:" + randomUUID(), attempt: 0, actor: actor.sub, previous: item.status, state: "planned",
          conditions: checklist, checklistVersion: version,
          result: {
            loanId: randomUUID(), reservationId, itemId: reservation.item_id, borrowerId: reservation.borrower_id,
            borrowedAt: accepted, dueDate: reservation.end_at.toISOString(), studentConfirmedAt: accepted, status: "checked_out",
          },
        };
        await persist(op);
      }
    }
    await commit(); // The plan is durable BEFORE Equipment changes.

    const itemId = reservation.item_id;
    async function change(operation: HandoverOperation, undo: boolean) {
      const status = undo ? operation.previous : "checked_out";
      const expectedStatus = undo ? "checked_out" : operation.previous;
      const expectedOperationKey = undo ? operation.key + ":" + operation.attempt + ":apply" : operation.attempt > 0 ? operation.key + ":" + (operation.attempt - 1) + ":undo" : undefined;
      const receipt = await remote(() => equipment.changeStatus({
        itemId, labId: actor.lab_id, changedBy: operation.actor, status, expectedStatus: [expectedStatus],
        ...(expectedOperationKey === undefined ? {} : { expectedOperationKey }),
        idempotencyKey: operation.key + ":" + operation.attempt + (undo ? ":undo" : ":apply"),
        reason: undo ? UNDO_REASON : CHECKOUT_REASON,
      }));
      // A receipt may replay an old change. It cannot prove current state.
      const current = await remote(() => equipment.getItem(itemId, actor.lab_id));
      if (!receipt.changed || current?.status !== status) throw handoverUncertain();
    }
    async function compensate(operation: HandoverOperation) {
      if (operation.actor !== actor.sub) throw starterOnly();
      operation.state = "compensating";
      await persist(operation);
      // Hold the reservation row through undo so another Loans writer cannot
      // complete this handover between the loan check and the undo.
      await begin();
      const row = await client.query("select id from public.reservations where id = $1 and lab_id = $2 for update", [reservationId, actor.lab_id]);
      if (!row.rows.length || await loanExists(operation.result.loanId)) throw handoverUncertain();
      try { await change(operation, true); }
      catch { throw handoverUncertain(); }
      operation.state = "compensated";
      await persist(operation);
      await commit();
    }

    if (op.state === "compensating") { await compensate(op); throw handoverUncertain(); }
    if (op.state === "compensated") {
      // Same confirmed checklist, new generation guarded by ownership of the
      // previous undo; it can never mistake the original apply receipt.
      op.attempt += 1; op.state = "planned"; await persist(op);
    }
    if (op.state === "planned") {
      await change(op, false); // Ambiguous outcome leaves the SAME durable plan/key.
      op.state = "applied"; await persist(op);
    } else {
      const current = await remote(() => equipment.getItem(itemId, actor.lab_id));
      if (current?.status !== "checked_out") throw handoverUncertain();
    }

    // Post-checkout authoritative re-verification through the owners' APIs.
    // Definitive failures undo the checkout; unavailability leaves the durable
    // 'applied' plan for Finish interrupted handover. This narrows, but does
    // not remove, the cross-service window before the local COMMIT below.
    let ineligible: LoansError | null = null;
    try { await users.verifyBorrower(op.result.borrowerId); }
    catch (error) {
      if (error instanceof LoansError && error.code === "borrower_unverified") ineligible = error;
      else if (error instanceof LoansError && error.status === 403) throw error;
      else throw incomplete();
    }
    if (!ineligible) {
      let latest: string;
      try { latest = (await componentsVersion(itemId)).version; }
      catch { throw incomplete(); }
      if (latest !== op.checklistVersion) ineligible = conflict(COMPONENTS_CHANGED);
    }

    let saved = false;
    if (!ineligible) {
      await begin();
      try {
        // Final submission: re-verify every SC rule on fresh, locked rows at the
        // server's current time before creating the loan.
        const fresh = await selectReservation();
        if (!fresh || fresh.item_id !== itemId || fresh.borrower_id !== op.result.borrowerId) {
          ineligible = conflict("The reservation changed during handover. Reload and check it again.");
          throw ineligible;
        }
        try { await lockedEligibility(fresh, new Date()); }
        catch (error) { ineligible = error instanceof LoansError ? error : conflict("Only confirmed reservations can be handed over."); throw ineligible; }
        await saveHandoverRecordsInTransaction(client, op.result, actor.lab_id, op.conditions, op.actor);
        op.state = "completed"; await persist(op);
        saved = true;
      } catch {
        if (!(await rollback())) throw handoverUncertain();
        op.state = "applied"; // Nothing from this transaction was committed.
      }
    }
    if (!saved) {
      // Never undo checkout if some other writer has already recorded this loan.
      if (await loanExists(op.result.loanId)) throw handoverUncertain();
      // Only the starting assistant may undo; others leave the durable plan.
      if (op.actor !== actor.sub) throw ineligible ?? incomplete();
      await compensate(op);
      if (ineligible) throw ineligible;
      throw new LoansError(503, "handover_rolled_back", "Handover records were not saved. Equipment was restored. Retry the same handover information.");
    }
    await commit();
    return op.result;
  } finally {
    if (!broken && transaction) await rollback();
    if (locked && !broken) {
      try { await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [lockKey]); }
      catch { broken = true; }
    }
    // Destroy uncertain connections, releasing any session lock server-side.
    client.release(broken);
  }
}
