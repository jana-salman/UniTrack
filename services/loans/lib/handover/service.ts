import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { isHandoverOutcome, type HandoverOutcome, type UserIdentity } from "@unitrack/contracts";
import { getDatabasePool } from "../db";
import { LoansError, handoverUncertain } from "../errors";
import type { HandoverEquipmentPort } from "./equipment-port";
import { HandoverRuleError, checkFullEligibility, validateHandoverChecklist, validateHandoverInput } from "./rules";
import { saveHandoverRecordsInTransaction } from "./save-records";

type PriorStatus = "reserved" | "available";
export interface HandoverOperation {
  fingerprint: string; key: string; attempt: number; actor: string;
  previous: PriorStatus; result: HandoverOutcome;
  state: "planned" | "applied" | "compensating" | "compensated" | "completed";
}
interface ReservationRow {
  id: string; item_id: string; borrower_id: string; lab_id: number;
  start_at: Date; end_at: Date; status: string; handover_operation: HandoverOperation | null;
}

const conflict = (message: string) => new LoansError(409, "handover_conflict", message);
const CHECKOUT_REASON = "Handed over after pickup checklist and student confirmation.";
const UNDO_REASON = "Compensate failed handover record transaction.";

function validOperation(op: HandoverOperation, reservationId: string, actor: string): boolean {
  return typeof op.fingerprint === "string" && /^[a-f0-9]{64}$/.test(op.fingerprint)
    && typeof op.key === "string" && /^handover:[a-f0-9-]{36}$/.test(op.key)
    && Number.isSafeInteger(op.attempt) && op.attempt >= 0 && op.attempt < Number.MAX_SAFE_INTEGER
    && op.actor === actor && ["reserved", "available"].includes(op.previous)
    && ["planned", "applied", "compensating", "compensated", "completed"].includes(op.state)
    && isHandoverOutcome(op.result) && op.result.reservationId === reservationId;
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

/**
 * Request-driven handover Saga (same protocol as the reviewed return Saga):
 * 1. Student confirmation and checklist shape are enforced before ANY database
 *    or Equipment access.
 * 2. Under a session advisory lock, validate the reservation, Equipment state
 *    and authoritative components, then COMMIT a durable plan on the
 *    reservation before Equipment is contacted.
 * 3. Equipment checks the item out with a stable key (expectedStatus = observed
 *    prior status). Lost responses are retried with the SAME key.
 * 4. One local transaction inserts the loan and every pickup record.
 * 5. Only an acknowledged local rollback permits ownership-guarded undo. A
 *    failed COMMIT/ROLLBACK is uncertain and never compensated blindly.
 */
export async function confirmHandover(reservationId: string, raw: unknown, actor: UserIdentity, equipment: HandoverEquipmentPort): Promise<HandoverOutcome> {
  if (actor.kind !== "user" || actor.role !== "lab_assistant") throw new LoansError(403, "forbidden", "Permission denied.");
  reservationId = reservationId.toLowerCase();
  let input;
  try { input = validateHandoverInput(raw); }
  catch { throw new LoansError(400, "invalid_handover", "Invalid handover information. Check every component."); }
  // TC-3.7: without explicit student confirmation nothing is read or written.
  if (!input.studentConfirmed) throw new LoansError(400, "student_confirmation_required", "The student must confirm the handover before it can be completed.");
  const conditions = input.conditions;
  const fingerprint = createHash("sha256").update(JSON.stringify({ actor: actor.sub, reservationId, input })).digest("hex");
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
  /**
   * SC eligibility on LOCKED state, inside the caller's transaction. The item
   * advisory lock serializes handovers for DIFFERENT reservations of the same
   * item (the per-reservation session lock cannot), so the active-loan and
   * single-eligible-reservation counts cannot change between check and insert
   * through this service. Counts include every lab: an item has one lab.
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

  try {
    const lock = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtextextended($1, 0)) as locked", [lockKey]);
    if (!lock.rows[0]?.locked) throw conflict("A handover is already in progress. Retry the same information later.");
    locked = true;
    await begin();
    const selected = await client.query<ReservationRow>(
      "select id, item_id, borrower_id, lab_id, start_at, end_at, status, handover_operation from public.reservations where id = $1 and lab_id = $2 for update",
      [reservationId, actor.lab_id]);
    const reservation = selected.rows[0];
    if (!reservation) throw new LoansError(404, "reservation_not_found", "Reservation not found.");
    let op = reservation.handover_operation;
    if (op && op.fingerprint !== fingerprint) throw conflict("Handover information or confirming user differs from the recorded attempt.");
    if (op && !validOperation(op, reservationId, actor.sub)) throw handoverUncertain();
    const existing = await client.query<{ id: string }>("select id from public.loans where reservation_id = $1", [reservationId]);
    const existingLoan = existing.rows[0]?.id ?? null;
    if (op?.state === "completed") {
      // Exact replay (double click/retry): return the recorded result, write nothing.
      if (existingLoan !== op.result.loanId) throw handoverUncertain();
      await commit();
      return op.result;
    }
    if (existingLoan) throw conflict("This reservation has already been handed over.");

    // Equipment is known NOT to hold our checkout for a new plan or after a
    // confirmed undo, so ineligibility can be refused safely here. A planned or
    // applied plan may already hold a checkout; it is re-checked in the final
    // transaction instead, where failure is compensated.
    if (op?.state === "compensated") await lockedEligibility(reservation, new Date());
    if (!op) {
      const now = new Date();
      await lockedEligibility(reservation, now);
      const item = await remote(() => equipment.getItem(reservation.item_id, actor.lab_id));
      if (!item || item.id !== reservation.item_id || item.labId !== actor.lab_id) throw new LoansError(404, "equipment_missing", "Equipment item not found.");
      // No existing code moves an item to reserved when a reservation starts
      // (only Return does, for an active pickup window), and data-model.md says
      // reservations do not change physical status. A confirmed in-window
      // reservation is therefore the authority; available is accepted too.
      // UNRESOLVED ASSUMPTION pending the reservations owner (docs/handover-s2-09.md).
      if (item.status !== "reserved" && item.status !== "available") throw conflict("Only reserved or available equipment can be handed over.");
      const components = await remote(() => equipment.getKitComponents(reservation.item_id, actor.lab_id));
      try { validateHandoverChecklist(components, conditions); }
      catch (error) { throw conflict(error instanceof HandoverRuleError ? error.message : "Check every kit component listed for this equipment."); }
      const accepted = now.toISOString();
      op = {
        fingerprint, key: "handover:" + randomUUID(), attempt: 0, actor: actor.sub, previous: item.status, state: "planned",
        result: {
          loanId: randomUUID(), reservationId, itemId: reservation.item_id, borrowerId: reservation.borrower_id,
          borrowedAt: accepted, dueDate: reservation.end_at.toISOString(), studentConfirmedAt: accepted, status: "checked_out",
        },
      };
      await persist(op);
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
      // A new generation is guarded by ownership of the previous undo; it can
      // never mistake the original apply receipt for a fresh checkout.
      op.attempt += 1; op.state = "planned"; await persist(op);
    }
    if (op.state === "planned") {
      await change(op, false); // Ambiguous outcome leaves the SAME durable plan/key.
      op.state = "applied"; await persist(op);
    } else {
      const current = await remote(() => equipment.getItem(itemId, actor.lab_id));
      if (current?.status !== "checked_out") throw handoverUncertain();
    }

    await begin();
    let ineligible: LoansError | null = null;
    try {
      // Final submission: independently re-verify every SC rule on fresh,
      // locked rows at the server's current time before creating the loan.
      const fresh = (await client.query<ReservationRow>(
        "select id, item_id, borrower_id, lab_id, start_at, end_at, status, handover_operation from public.reservations where id = $1 and lab_id = $2 for update",
        [reservationId, actor.lab_id])).rows[0];
      if (!fresh || fresh.item_id !== itemId || fresh.borrower_id !== op.result.borrowerId) throw handoverUncertain();
      try { await lockedEligibility(fresh, new Date()); }
      catch (error) { ineligible = error instanceof LoansError ? error : conflict("Only confirmed reservations can be handed over."); throw ineligible; }
      await saveHandoverRecordsInTransaction(client, op.result, actor.lab_id, conditions, actor.sub);
      op.state = "completed"; await persist(op);
    } catch {
      if (!(await rollback())) throw handoverUncertain();
      // Never undo checkout if some other writer has already recorded this loan.
      if (await loanExists(op.result.loanId)) throw handoverUncertain();
      await compensate(op);
      // The checkout was undone (ownership-guarded). Report the failed rule.
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
