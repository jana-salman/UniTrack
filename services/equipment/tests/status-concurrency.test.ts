import { describe, expect, it } from "vitest";
import { updateEquipmentStatus, type StatusDatabaseClient } from "../lib/equipment-status-transaction";
const first = "550e8400-e29b-41d4-a716-446655440000";
const second = "550e8400-e29b-41d4-a716-446655440002";
const actor = "550e8400-e29b-41d4-a716-446655440001";
// Deterministic separate-connection transaction/lock model, NOT PostgreSQL.
function database() {
 const statuses = new Map([[first, "available"], [second, "available"]]);
 const history: Record<string, unknown>[] = [];
 const tails = new Map<string, Promise<void>>();
 const statements: string[] = [];
 async function lock(name: string) {
   const previous = tails.get(name) ?? Promise.resolve();
   let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
   tails.set(name, previous.then(() => held)); await previous; return release;
 }
 function connection(legacyCollision = false): StatusDatabaseClient {
   const releases: (() => void)[] = []; let item: string | undefined; let pendingStatus: string | undefined;
   const pendingHistory: Record<string, unknown>[] = [];
   return { async query(sql, values = []) {
     statements.push(sql);
     if (sql.includes("pg_advisory_xact_lock")) releases.push(await lock("key:" + values[0]));
     if (sql.includes("FOR UPDATE")) {
       item = String(values[0]); releases.push(await lock("item:" + item));
       return { rows: [{ id: item, lab_id: 1, status: statuses.get(item) }] };
     }
     if (sql.includes("FROM public.equipment_status_history")) return { rows: history.filter(r => r.request_key === values[0]) };
     if (sql.startsWith("UPDATE")) pendingStatus = String(values[0]);
     if (sql.startsWith("INSERT")) {
       if (legacyCollision) throw Object.assign(new Error("raw database conflict details"), { code: "23505", constraint: "equipment_status_history_request_key_unique" });
       pendingHistory.push({ item_id: values[0], lab_id: values[1], old_status: values[2], new_status: values[3], request_key: values[6], request_fingerprint: values[7] });
     }
     if (sql === "COMMIT" || sql === "ROLLBACK") {
       if (sql === "COMMIT") { if (item && pendingStatus) statuses.set(item, pendingStatus); history.push(...pendingHistory); }
       for (const release of releases.reverse()) release();
     }
     return { rows: [] };
   } };
 }
 return { statuses, history, statements, connection };
}
describe("status concurrency ordering (modeled locks)", () => {
 it("serializes concurrent exact replays across separate connections", async () => {
   const db = database(); const options = { expectedStatus: "available", idempotencyKey: "parallel:1" };
   const results = await Promise.all([db.connection(), db.connection()].map(c => updateEquipmentStatus(c, first, "checked_out", actor, 1, undefined, options)));
   expect(results.filter(r => r.alreadyApplied)).toHaveLength(1); expect(db.history).toHaveLength(1);
   expect(db.statuses.get(first)).toBe("checked_out");
   expect(db.statements.filter(s => s === "SET TRANSACTION ISOLATION LEVEL READ COMMITTED")).toHaveLength(2);
 });
 it("rejects concurrent different-item reuse of one global key", async () => {
   const db = database(); const options = { expectedStatus: "available", idempotencyKey: "parallel:2" };
   const result = await Promise.allSettled([first, second].map(id => updateEquipmentStatus(db.connection(), id, "checked_out", actor, 1, undefined, options)));
   expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
   const failed = result.find(r => r.status === "rejected") as PromiseRejectedResult;
   expect(failed.reason.message).toBe("Idempotency key was already used for a different status change"); expect(db.history).toHaveLength(1);
 });
 it("uses the item lock to reject stale status expectations with different keys", async () => {
   const db = database();
   const result = await Promise.allSettled(["one", "two"].map(key => updateEquipmentStatus(db.connection(), first, "checked_out", actor, 1, undefined, { expectedStatus: "available", idempotencyKey: key })));
   expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
   expect((result.find(r => r.status === "rejected") as PromiseRejectedResult).reason.message).toContain("Equipment status changed");
   expect(db.history).toHaveLength(1);
 });
 it("rolls back and sanitizes a uniqueness collision from a legacy writer", async () => {
   const db = database();
   await expect(updateEquipmentStatus(db.connection(true), first, "checked_out", actor, 1, undefined, { idempotencyKey: "legacy:1" })).rejects.toThrow("Idempotency key was already used for a different status change");
   expect(db.history).toHaveLength(0); expect(db.statuses.get(first)).toBe("available"); expect(db.statements.at(-1)).toBe("ROLLBACK");
 });
});
