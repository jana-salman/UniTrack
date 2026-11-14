// Selectively derived from return branch 3f220aa: locking and immutable request keys.
import { createHash } from "node:crypto";
import { validateStatusChange } from "./equipment-status-change";
import { isValidEquipmentStatus } from "./equipment-status";
export interface StatusDatabaseClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export interface StatusChangeOptions { expectedStatus?: string | readonly string[]; idempotencyKey?: string; expectedOperationKey?: string; trackOperation?: boolean }
export class EquipmentStatusConflictError extends Error {
  constructor() { super("Equipment status changed. Reload before trying again."); }
}
export class IdempotencyKeyConflictError extends Error {
  constructor() { super("Idempotency key was already used for a different status change"); }
}
export function normalizeStatusOptions(options: StatusChangeOptions) {
  const raw = options.expectedStatus;
  const list = raw === undefined ? undefined : typeof raw === "string" ? [raw] : raw;
  if (list !== undefined && (!Array.isArray(list) || !list.length || !list.every(isValidEquipmentStatus))) throw new Error("Invalid expectedStatus");
  const expected = list === undefined ? undefined : [...new Set(list)].sort();
  const key = options.idempotencyKey;
  if (key !== undefined && (typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(key) || /[\r\n]/.test(key))) throw new Error("Invalid idempotency key");
  const owner = options.expectedOperationKey;
  if (owner !== undefined && (typeof owner !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(owner) || /[\r\n]/.test(owner))) throw new Error("Invalid expected operation key");
  if (options.trackOperation !== undefined && typeof options.trackOperation !== "boolean") throw new Error("Invalid operation tracking option");
  return { expected, requestKey: key, expectedOperationKey: owner, trackOperation: options.trackOperation === true || owner !== undefined };
}
export async function updateEquipmentStatus(db: StatusDatabaseClient, itemId: string, newStatus: string, changedBy: string, labId: number, reason?: string, options: StatusChangeOptions = {}) {
  const input = validateStatusChange(itemId, newStatus, reason);
  if (!Number.isSafeInteger(labId) || labId <= 0) throw new Error("Invalid laboratory ID");
  const { expected, requestKey, expectedOperationKey, trackOperation } = normalizeStatusOptions(options);
  // Ordinary pre-existing request fingerprints remain unchanged.
  const fingerprint = createHash("sha256").update(JSON.stringify({ itemId: input.itemId, labId, changedBy, status: input.newStatus, reason: input.reason ?? null, expected: expected ?? null, ...(trackOperation ? { trackOperation, ...(expectedOperationKey === undefined ? {} : { expectedOperationKey }) } : {}) })).digest("hex");
  await db.query("BEGIN");
  try {
    // A waiting replay must see the prior committed receipt, regardless of role defaults.
    await db.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    if (requestKey) await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [requestKey]);
    const result = await db.query(
      `SELECT id, lab_id, status${trackOperation ? ", status_request_key" : ""} FROM public.equipment_items WHERE id = $1 AND lab_id = $2 FOR UPDATE`, [input.itemId, labId]);
    if (!result.rows.length) throw new Error("Equipment item not found or access denied");
    const oldStatus = result.rows[0].status as string;
    if (requestKey) {
      const previous = await db.query(
        `SELECT item_id, lab_id, old_status, new_status, request_fingerprint FROM public.equipment_status_history WHERE request_key = $1`, [requestKey]);
      const saved = previous.rows[0];
      if (saved) {
        if (saved.request_fingerprint !== fingerprint) throw new IdempotencyKeyConflictError();
        await db.query("COMMIT");
        return { itemId: input.itemId, status: saved.new_status as string, changed: saved.old_status !== saved.new_status, alreadyApplied: true };
      }
    }
    // Exact replay above never reapplies. A NEW guarded action must still own
    // the last status operation; value-only checks cannot detect ABA changes.
    if (expectedOperationKey !== undefined && result.rows[0].status_request_key !== expectedOperationKey) throw new EquipmentStatusConflictError();
    if (expected && !expected.some(status => status === oldStatus)) throw new EquipmentStatusConflictError();
    const changed = oldStatus !== input.newStatus;
    if (changed) await db.query(`UPDATE public.equipment_items SET status = $1 WHERE id = $2 AND lab_id = $3`, [input.newStatus, input.itemId, labId]);
    // Keyed no-ops have an immutable receipt; unkeyed no-ops keep no-history behavior.
    if (changed || requestKey) {
      const values = [input.itemId, labId, oldStatus, input.newStatus, changedBy, input.reason ?? null];
      if (requestKey) await db.query(
        `INSERT INTO public.equipment_status_history (item_id, lab_id, old_status, new_status, changed_by, reason, request_key, request_fingerprint) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [...values, requestKey, fingerprint]);
      else await db.query(
        `INSERT INTO public.equipment_status_history (item_id, lab_id, old_status, new_status, changed_by, reason) VALUES ($1, $2, $3, $4, $5, $6)`, values);
    }
    await db.query("COMMIT");
    return { itemId: input.itemId, status: input.newStatus, changed };
  } catch (error) {
    try { await db.query("ROLLBACK"); } catch { /* Preserve original failure without logging. */ }
    if (error && typeof error === "object" && "code" in error && error.code === "23505" && "constraint" in error && error.constraint === "equipment_status_history_request_key_unique") throw new IdempotencyKeyConflictError();
    throw error;
  }
}
