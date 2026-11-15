import { beforeEach, expect, it, vi } from "vitest";
import { returnDatabase, loanId, itemId, actorId } from "./fixtures/return-db";
import type { UserIdentity } from "@unitrack/contracts";
import type { EquipmentStatus, ReturnStatusChange } from "../lib/returns/equipment-port";
vi.mock("server-only", () => ({}));
const holder = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("../lib/db", () => ({ getDatabasePool: () => holder.pool }));
import { confirmReturn } from "../lib/returns/service";
let db: ReturnType<typeof returnDatabase>;
let status: EquipmentStatus;
let owner: string | null;
let loss: boolean, undoConflict: boolean;
let receipts: Map<string, { fingerprint: string; changed: boolean }>;
const calls: ReturnStatusChange[] = [];
const actor: UserIdentity = { kind: "user", sub: actorId, role: "lab_assistant", lab_id: 7, rid: "return-test" };
const input = { conditions: [{ kitComponentId: null, conditionStatus: "good" }] };
const equipment = {
  getComponents: async () => [],
  getItem: vi.fn(async () => ({ id: itemId, name: "", labId: 7, status })),
  changeStatus: vi.fn(async (request: ReturnStatusChange) => {
    calls.push(request);
    if (undoConflict && request.idempotencyKey.endsWith(":undo")) throw new Error("Dummy compensation conflict");
    const fingerprint = JSON.stringify(request);
    const old = receipts.get(request.idempotencyKey);
    if (old) { if (old.fingerprint !== fingerprint) throw new Error("Dummy key misuse"); return { changed: old.changed }; }
    if (request.expectedOperationKey !== undefined && request.expectedOperationKey !== owner) throw new Error("Dummy ownership conflict");
    if (!request.expectedStatus.includes(status)) throw new Error("Dummy status conflict");
    const changed = status !== request.status; status = request.status; owner = request.idempotencyKey;
    receipts.set(request.idempotencyKey, { fingerprint, changed });
    if (loss) { loss = false; throw new Error("Dummy lost response after committed Equipment change"); }
    return { changed };
  }),
};
beforeEach(() => {
  db = returnDatabase(); holder.pool = db.pool; status = "checked_out"; owner = null; receipts = new Map(); calls.length = 0; loss = false; undoConflict = false;
  equipment.getItem.mockClear(); equipment.changeStatus.mockClear();
});
const confirm = (body: unknown = input, identity = actor) => confirmReturn(loanId, body, identity, equipment);
it("saves a clean return after Equipment, with late information and atomic immutable records", async () => {
  const result = await confirm(); expect(result).toMatchObject({ loanId, status: "available", isLate: false });
  expect(db.state.records).toHaveLength(1); expect(db.state.loan.returned_at).toEqual(new Date(result.returnedAt));
  expect(calls[0]).toMatchObject({ status: "available", expectedStatus: ["checked_out"] });
  expect(db.sql.filter(q => q.text === "COMMIT")).toHaveLength(2);
});
it("replays completed requests without further changes and rejects different inputs", async () => {
  const first = await confirm(); expect(await confirm()).toEqual(first); expect(calls).toHaveLength(1); expect(db.state.records).toHaveLength(1);
  await expect(confirm({ conditions: [{ kitComponentId: null, conditionStatus: "damaged" }] })).rejects.toMatchObject({ status: 409 });
  await expect(confirm(input, { ...actor, sub: "another-assistant" })).rejects.toMatchObject({ status: 409 });
});
it.each(["missing", "unknown", "damaged"])("requires inspection for %s", async conditionStatus => {
  expect((await confirm({ conditions: [{ kitComponentId: null, conditionStatus }] })).status).toBe("inspection_required");
});
it("distinguishes existing and new damage", async () => {
  db.state.pickup[0].condition_status = "damaged";
  expect((await confirm({ conditions: [{ kitComponentId: null, conditionStatus: "damaged" }] })).status).toBe("available");
});
it("records newDamage notes and lateness with the return", async () => {
  db.state.loan.due_date = new Date("2001-01-01");
  expect(await confirm({ conditions: [{ kitComponentId: null, conditionStatus: "damaged", newDamage: true, notes: "New crack" }] })).toMatchObject({ status: "inspection_required", isLate: true });
  expect(db.state.records[0][5]).toContain("New or additional damage");
});
it("keeps active-pickup status distinct from a future reservation", async () => {
  db.settings.activePickup = true; expect((await confirm()).status).toBe("reserved");
  const query = db.sql.find(q => q.text.includes("select exists")); expect(query?.text).toContain("start_at <= $3"); expect(query?.text).toContain("end_at > $3"); expect(query?.text).toContain("id is distinct from");
});
it("rejects incomplete pickup checklists before changing Equipment", async () => {
  db.state.pickup.push({ id: "component", kit_component_id: "component", condition_status: "good", notes: null });
  await expect(confirm()).rejects.toMatchObject({ status: 409 }); expect(calls).toHaveLength(0);
});
it("does not save when Equipment fails", async () => {
  equipment.changeStatus.mockRejectedValueOnce(new Error("Dummy confirmed failure"));
  await expect(confirm()).rejects.toThrow(); expect(db.state.records).toHaveLength(0); expect(db.state.loan.returned_at).toBeNull();
});
it("treats a no-op receipt as needing reconciliation, without saving or undoing", async () => {
  equipment.changeStatus.mockResolvedValueOnce({ changed: false });
  await expect(confirm()).rejects.toMatchObject({ code: "return_state_uncertain" }); expect(db.state.records).toHaveLength(0); expect(equipment.changeStatus).toHaveBeenCalledOnce();
});
it("rejects a mismatched Equipment lab even if the adapter returns an item", async () => {
  equipment.getItem.mockResolvedValueOnce({ id: itemId, name: "", labId: 8, status: "checked_out" });
  await expect(confirm()).rejects.toMatchObject({ status: 404 }); expect(equipment.changeStatus).not.toHaveBeenCalled();
});
it("safely retries response loss using the exact same Equipment key", async () => {
  loss = true; await expect(confirm()).rejects.toThrow(); expect(status).toBe("available"); expect(db.state.records).toHaveLength(0);
  expect((await confirm()).status).toBe("available"); expect(calls[0]).toEqual(calls[1]); expect(receipts.size).toBe(1);
});
it("does not mistake a replay receipt for current Equipment state", async () => {
  loss = true; await expect(confirm()).rejects.toThrow(); status = "under_maintenance";
  await expect(confirm()).rejects.toMatchObject({ code: "return_state_uncertain" }); expect(db.state.records).toHaveLength(0); expect(calls.every(c => !c.idempotencyKey.endsWith(":undo"))).toBe(true);
});
it("rolls back local records, compensates actual prior status, and uses a fresh attempt key after restoration", async () => {
  status = "overdue"; db.settings.historyFailure = true;
  await expect(confirm()).rejects.toMatchObject({ code: "return_rolled_back" }); expect(status).toBe("overdue"); expect(db.state.records).toHaveLength(0); expect(db.state.loan.returned_at).toBeNull();
  expect(calls[1]).toMatchObject({ status: "overdue", expectedStatus: ["available"] });
  db.settings.historyFailure = false; await confirm(); expect(calls[2].idempotencyKey).not.toBe(calls[0].idempotencyKey); expect(db.state.records).toHaveLength(1);
});
it("leaves compensation conflicts pending for staff instead of blindly overwriting", async () => {
  db.settings.historyFailure = true; undoConflict = true;
  await expect(confirm()).rejects.toMatchObject({ code: "return_state_uncertain" });
  expect(db.state.loan.return_operation).toMatchObject({ state: "compensating" }); expect(status).toBe("available");
  await expect(confirm()).rejects.toMatchObject({ code: "return_state_uncertain" }); expect(calls[1].idempotencyKey).toBe(calls[2].idempotencyKey);
});
it("blocks interrupted compensation after another action restores the same status", async () => {
  db.settings.historyFailure = true; undoConflict = true;
  await expect(confirm()).rejects.toThrow();
  undoConflict = false; owner = "other-completed-action"; status = "available";
  await expect(confirm()).rejects.toMatchObject({ code: "return_state_uncertain" });
  expect(status).toBe("available"); expect(db.state.loan.return_operation).toMatchObject({ state: "compensating" });
});
it("does not start a new generation after another action replaces a compensated operation", async () => {
  db.settings.historyFailure = true; await expect(confirm()).rejects.toMatchObject({ code: "return_rolled_back" });
  owner = "another-pickup"; status = "checked_out"; db.settings.historyFailure = false;
  await expect(confirm()).rejects.toThrow(); expect(db.state.records).toHaveLength(0); expect(status).toBe("checked_out");
});
it.each(["before", "after"] as const)("never compensates uncertain local COMMIT (%s), and safely reconciles retry", async mode => {
  db.settings.commitFailure = mode;
  await expect(confirm()).rejects.toMatchObject({ code: "return_state_uncertain" }); expect(calls).toHaveLength(1);
  await confirm(); expect(db.state.records).toHaveLength(1); expect(calls).toHaveLength(1);
});
it("does not compensate an unacknowledged rollback", async () => {
  db.settings.historyFailure = true; db.settings.rollbackFailure = true;
  await expect(confirm()).rejects.toMatchObject({ code: "return_state_uncertain" }); expect(calls).toHaveLength(1);
});
it("does not compensate if a legacy writer recorded the return independently", async () => {
  db.settings.historyFailure = true; db.settings.legacyReturnAfterRollback = true;
  await expect(confirm()).rejects.toMatchObject({ code: "return_state_uncertain" }); expect(calls).toHaveLength(1); expect(status).toBe("available");
});
it("serializes concurrent attempts with separate modeled connections", async () => {
  const results = await Promise.allSettled([confirm(), confirm()]); expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(db.state.records).toHaveLength(1); expect(calls).toHaveLength(1);
});
it("canonicalizes UUID spelling before acquiring the same loan lock", async () => {
  const results = await Promise.allSettled([confirm(), confirmReturn(loanId.toUpperCase(), input, actor, equipment)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(new Set(db.sql.filter(q => q.text.includes("pg_try_advisory_lock")).map(q => q.values[0])).size).toBe(1);
  expect(db.state.records).toHaveLength(1);
});
it.each(["before", "after"] as const)("never changes Equipment after an uncertain initial plan COMMIT (%s)", async mode => {
  db.settings.planCommitFailure = mode;
  await expect(confirm()).rejects.toMatchObject({ code: "return_state_uncertain" }); expect(calls).toHaveLength(0);
  expect((await confirm()).status).toBe("available"); expect(db.state.records).toHaveLength(1);
});
it.each(["before", "after"] as const)("recovers uncertain compensation COMMIT (%s) without a second undo", async mode => {
  db.settings.historyFailure = true; db.settings.compensationCommitFailure = mode;
  await expect(confirm()).rejects.toMatchObject({ code: "return_state_uncertain" }); expect(status).toBe("checked_out"); expect(receipts.size).toBe(2);
  db.settings.historyFailure = false;
  if (mode === "before") await expect(confirm()).rejects.toMatchObject({ code: "return_state_uncertain" });
  expect((await confirm()).status).toBe("available"); expect(receipts.size).toBe(3); expect(db.state.records).toHaveLength(1);
});
it("refuses to call Equipment if the durable plan write affects no row", async () => {
  db.settings.dropPlanWrite = true; await expect(confirm()).rejects.toMatchObject({ code: "return_state_uncertain" }); expect(calls).toHaveLength(0);
});
it("fails closed on an unrecognized persisted operation state", async () => {
  loss = true; await expect(confirm()).rejects.toThrow();
  (db.state.loan.return_operation as { state: string }).state = "unknown";
  await expect(confirm()).rejects.toMatchObject({ code: "return_state_uncertain" }); expect(calls).toHaveLength(1); expect(db.state.records).toHaveLength(0);
});
it("rejects other labs and students, returned loans and unborrowed Equipment", async () => {
  await expect(confirm(input, { ...actor, lab_id: 8 })).rejects.toMatchObject({ status: 404 });
  await expect(confirm(input, { ...actor, role: "student" })).rejects.toMatchObject({ status: 403 });
  status = "available"; await expect(confirm()).rejects.toMatchObject({ status: 409 });
  db.state.loan.returned_at = new Date(); await expect(confirm()).rejects.toMatchObject({ status: 409 }); expect(calls).toHaveLength(0);
});
