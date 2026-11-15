import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { UserIdentity } from "@unitrack/contracts";
import { getDatabasePool } from "../db";
import { LoansError, uncertain } from "../errors";
import type { ReturnEquipmentPort, EquipmentStatus, ReturnOutcome } from "./equipment-port";
import type { ReturnLoan, PickupCondition } from "./types";
import { validateReturnInput } from "./validation";
import { validateReturnChecklist } from "./checklist";
import { requiresInspection } from "./inspection";
import { determineReturnOutcome } from "./rules";
import { hasActivePickup } from "./queries";
import { saveReturnRecordsInTransaction } from "./save-records";

interface Operation {
  fingerprint: string; key: string; attempt: number; actor: string;
  previous: EquipmentStatus; result: ReturnOutcome;
  state: "planned" | "applied" | "compensating" | "compensated" | "completed";
}
type Loan = ReturnLoan & { return_operation: Operation | null };
const conflict = (message: string) => new LoansError(409, "return_conflict", message);
function validOperation(value: Operation, loanId: string, actor: string): boolean {
  const result = value.result;
  return typeof value.fingerprint === "string" && /^[a-f0-9]{64}$/.test(value.fingerprint)
    && typeof value.key === "string" && /^return:[a-f0-9-]{36}$/.test(value.key)
    && Number.isSafeInteger(value.attempt) && value.attempt >= 0 && value.attempt < Number.MAX_SAFE_INTEGER
    && value.actor === actor && ["checked_out", "overdue"].includes(value.previous)
    && ["planned", "applied", "compensating", "compensated", "completed"].includes(value.state)
    && !!result && result.loanId === loanId && ["available", "reserved", "inspection_required"].includes(result.status)
    && typeof result.isLate === "boolean" && typeof result.returnedAt === "string" && Number.isFinite(Date.parse(result.returnedAt));
}

/** Session lock spans the durable plan, remote call and final local transaction.
 * Each remote step has a stable, persisted key. A failed COMMIT/ROLLBACK NEVER
 * triggers compensation. Retry reads durable state on a new connection first.
 * This is a recoverable request-driven Saga, not a background recovery worker.
 */
export async function confirmReturn(loanId: string, raw: unknown, actor: UserIdentity, equipment: ReturnEquipmentPort): Promise<ReturnOutcome> {
  if (actor.role !== "lab_assistant") throw new LoansError(403, "forbidden", "Permission denied.");
  // PostgreSQL UUID equality is case-insensitive; the advisory lock must be too.
  loanId = loanId.toLowerCase();
  let input;
  try { input = validateReturnInput(raw); } catch { throw new LoansError(400, "invalid_return", "Invalid return information. Check every condition."); }
  for (const condition of input.conditions) {
    condition.notes = condition.notes?.trim() || "";
    condition.kitComponentId = condition.kitComponentId?.toLowerCase() ?? null;
  }
  // Order does not alter a checklist's meaning. Identity and normalized content do.
  input.conditions.sort((a, b) => { const left = a.kitComponentId ?? "", right = b.kitComponentId ?? ""; return left < right ? -1 : left > right ? 1 : 0; });
  const fingerprint = createHash("sha256").update(JSON.stringify({ actor: actor.sub, input })).digest("hex");
  const client = await getDatabasePool().connect();
  let locked = false, transaction = false, broken = false;
  async function begin() { await client.query("BEGIN"); transaction = true; }
  async function commit() {
    // COMMIT failure is ambiguous even if a later ROLLBACK succeeds.
    try { await client.query("COMMIT"); transaction = false; }
    catch { broken = true; throw uncertain(); }
  }
  async function rollback(): Promise<boolean> {
    if (!transaction) return true;
    try { await client.query("ROLLBACK"); transaction = false; return true; }
    catch { broken = true; return false; }
  }
  async function persist(op: Operation) {
    const saved = await client.query("update public.loans set return_operation = $1::jsonb where id = $2 and lab_id = $3 returning id", [JSON.stringify(op), loanId, actor.lab_id]);
    if (saved.rows.length !== 1) throw uncertain();
  }
  try {
    const lock = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtextextended($1, 0)) as locked", ["loans:return:" + loanId]);
    if (!lock.rows[0]?.locked) throw conflict("A return is already in progress. Retry the same information later.");
    locked = true;
    await begin();
    const selected = await client.query<Loan>("select id, item_id, borrower_id, reservation_id, lab_id, borrowed_at, due_date, returned_at, return_operation from public.loans where id = $1 and lab_id = $2 for update", [loanId, actor.lab_id]);
    const loan = selected.rows[0];
    if (!loan) throw new LoansError(404, "loan_not_found", "Loan not found.");
    let op = loan.return_operation;
    if (op && op.fingerprint !== fingerprint) throw conflict("Return information or confirming user differs from the recorded attempt.");
    if (op && (!validOperation(op, loanId, actor.sub) || (op.state === "completed" && !loan.returned_at))) throw uncertain();
    if (loan.returned_at) {
      if (op?.state === "completed") {
        if (loan.returned_at.getTime() !== Date.parse(op.result.returnedAt)) throw uncertain();
        await commit(); return op.result;
      }
      throw conflict("This loan has already been returned.");
    }
    if (!op) {
      const pickup = await client.query<PickupCondition>("select id, kit_component_id, condition_status, notes from public.condition_records where loan_id = $1 and item_id = $2 and lab_id = $3 and phase = 'pickup' order by recorded_at, id", [loan.id, loan.item_id, actor.lab_id]);
      try { validateReturnChecklist(pickup.rows, input.conditions); }
      catch (error) { throw conflict(error instanceof Error ? error.message : "Invalid pickup checklist."); }
      const item = await equipment.getItem(loan.item_id, actor.lab_id);
      if (!item || item.labId !== actor.lab_id || item.id !== loan.item_id) throw new LoansError(404, "equipment_missing", "Equipment item not found.");
      if (!["checked_out", "overdue"].includes(item.status)) throw conflict("Only borrowed or overdue items can be returned.");
      const returnedAt = new Date();
      const outcome = determineReturnOutcome(loan, returnedAt, requiresInspection(pickup.rows, input.conditions), await hasActivePickup(loan, returnedAt, client));
      op = { fingerprint, key: "return:" + randomUUID(), attempt: 0, actor: actor.sub, previous: item.status, result: { loanId, returnedAt: returnedAt.toISOString(), ...outcome }, state: "planned" };
      await persist(op);
    }
    await commit(); // Plan must be durable BEFORE Equipment changes.

    async function change(operation: Operation, undo: boolean) {
      const status = undo ? operation.previous : operation.result.status;
      const previous = undo ? operation.result.status : operation.previous;
      const expectedOperationKey = undo ? operation.key + ":" + operation.attempt + ":apply" : operation.attempt > 0 ? operation.key + ":" + (operation.attempt - 1) + ":undo" : undefined;
      const receipt = await equipment.changeStatus({ itemId: loan.item_id, labId: actor.lab_id, changedBy: operation.actor, status, expectedStatus: [previous], ...(expectedOperationKey === undefined ? {} : { expectedOperationKey }), idempotencyKey: operation.key + ":" + operation.attempt + (undo ? ":undo" : ":apply"), reason: undo ? "Compensate failed return record transaction." : "Equipment returned after condition check." });
      // A receipt may replay an old change. It cannot prove current state.
      const current = await equipment.getItem(loan.item_id, actor.lab_id);
      if (!receipt.changed || current?.status !== status) throw uncertain();
    }
    async function compensate(operation: Operation) {
      // Persist intent before contacting Equipment. Lost undo responses are retried
      // with the same key. A new apply key is allocated only after confirmed undo.
      operation.state = "compensating";
      await persist(operation);
      // Hold the loan row through undo, including resumed compensation. Another
      // Loans writer cannot complete it between the saved-state check and undo.
      await begin();
      const currentLoan = await client.query<{ returned_at: Date | null }>("select returned_at from public.loans where id = $1 and lab_id = $2 for update", [loanId, actor.lab_id]);
      if (!currentLoan.rows[0] || currentLoan.rows[0].returned_at) throw uncertain();
      try { await change(operation, true); }
      catch { throw uncertain(); }
      operation.state = "compensated";
      await persist(operation);
      await commit();
    }
    if (op.state === "compensating") { await compensate(op); throw uncertain(); }
    if (op.state === "compensated") {
      // A different actor/status may have acted since compensation; expectedStatus
      // still checks under Equipment's lock. No receipt from an earlier apply is reused.
      op.attempt += 1; op.state = "planned"; await persist(op);
    }
    if (op.state === "planned") {
      await change(op, false); // Ambiguous outcome leaves the SAME durable plan/key.
      op.state = "applied"; await persist(op);
    } else {
      const current = await equipment.getItem(loan.item_id, actor.lab_id);
      if (current?.status !== op.result.status) throw uncertain();
    }
    await begin();
    try {
      await saveReturnRecordsInTransaction(client, loan, input, new Date(op.result.returnedAt), actor.sub);
      op.state = "completed"; await persist(op);
    } catch {
      if (!(await rollback())) throw uncertain();
      // Another legacy writer may not honor this Saga's advisory lock. Never
      // restore Equipment if that writer has already recorded a return.
      const saved = await client.query<{ returned_at: Date | null }>("select returned_at from public.loans where id = $1 and lab_id = $2", [loanId, actor.lab_id]);
      if (!saved.rows[0] || saved.rows[0].returned_at) throw uncertain();
      // Only a positively acknowledged local rollback permits compensation.
      await compensate(op);
      throw new LoansError(503, "return_rolled_back", "Return records were not saved. Equipment was restored. Retry the same return information.");
    }
    await commit();
    return op.result;
  } finally {
    if (!broken && transaction) await rollback();
    if (locked && !broken) {
      try { await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", ["loans:return:" + loanId]); }
      catch { broken = true; }
    }
    // Destroy uncertain connections, releasing any session lock server-side.
    client.release(broken);
  }
}
