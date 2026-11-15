import { describe, expect, it } from "vitest";
import { updateEquipmentStatus, type StatusDatabaseClient, type StatusChangeOptions } from "../lib/equipment-status-transaction";
const id = "550e8400-e29b-41d4-a716-446655440000";
const other = "550e8400-e29b-41d4-a716-446655440002";
const actor = "550e8400-e29b-41d4-a716-446655440001";
function fixture(initial = "available") {
  let status = initial;
  let owner: string | null = null;
  let history: Record<string, unknown>[] = [];
  let snapshot: { status: string; owner: string | null; history: Record<string, unknown>[] };
  const queries: { sql: string; values: unknown[] }[] = [];
  let failHistory = false;
  const client: StatusDatabaseClient = { async query(sql, values = []) {
    queries.push({ sql, values });
    if (sql === "BEGIN") snapshot = { status, owner, history: structuredClone(history) };
    if (sql === "ROLLBACK") { status = snapshot.status; owner = snapshot.owner; history = snapshot.history; }
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("FOR UPDATE")) return { rows: values[1] === 1 ? [{ id: values[0], lab_id: 1, status, status_request_key: owner }] : [] };
    if (sql.includes("FROM public.equipment_status_history")) return { rows: history.filter(h => h.request_key === values[0]) };
    if (sql.startsWith("UPDATE")) { status = String(values[0]); owner = null; }
    if (sql.startsWith("INSERT")) {
      if (failHistory) throw new Error("History failure");
      if (values[6] && history.some(h => h.request_key === values[6])) throw Object.assign(new Error("Duplicate receipt"), { code: "23505" });
      owner = typeof values[6] === "string" ? values[6] : null;
      history.push({ item_id: values[0], lab_id: values[1], old_status: values[2], new_status: values[3], changed_by: values[4], reason: values[5], request_key: values[6], request_fingerprint: values[7] });
    }
    return { rows: [] };
  } };
  return { client, queries, get status() { return status; }, get history() { return history; }, setStatus(value: string) { status = value; owner = null; }, fail() { failHistory = true; } };
}
const options = { expectedStatus: ["available", "reserved"], idempotencyKey: "operation:1" };
describe("atomic status requests", () => {
  it("only compensates the exact owned operation and safely replays its undo", async () => {
    const f = fixture("checked_out");
    await updateEquipmentStatus(f.client, id, "available", actor, 1, undefined, { trackOperation: true, idempotencyKey: "return:apply", expectedStatus: "checked_out" });
    const undo = { expectedStatus: "available", expectedOperationKey: "return:apply", idempotencyKey: "return:undo" };
    expect((await updateEquipmentStatus(f.client, id, "checked_out", actor, 1, undefined, undo)).changed).toBe(true);
    expect((await updateEquipmentStatus(f.client, id, "checked_out", actor, 1, undefined, undo)).alreadyApplied).toBe(true);
    expect(f.history).toHaveLength(2);
    await expect(updateEquipmentStatus(f.client, id, "checked_out", actor, 1, undefined, { ...undo, expectedOperationKey: "other:operation" })).rejects.toThrow("Idempotency key was already used");
  });
  it("rejects compensation after another completed action returns to the same status (ABA)", async () => {
    const f = fixture("checked_out");
    await updateEquipmentStatus(f.client, id, "available", actor, 1, undefined, { trackOperation: true, idempotencyKey: "return:apply" });
    await updateEquipmentStatus(f.client, id, "reserved", actor, 1, undefined, { idempotencyKey: "other:reserve" });
    await updateEquipmentStatus(f.client, id, "available", actor, 1, undefined, { idempotencyKey: "other:cancel" });
    await expect(updateEquipmentStatus(f.client, id, "checked_out", actor, 1, undefined, { expectedStatus: "available", expectedOperationKey: "return:apply", idempotencyKey: "return:undo" })).rejects.toThrow("Equipment status changed");
    expect(f.status).toBe("available"); expect(f.history).toHaveLength(3);
  });
  it("invalidates old ownership on unkeyed actions and keyed no-ops", async () => {
    for (const keyed of [false, true]) {
      const f = fixture("checked_out");
      await updateEquipmentStatus(f.client, id, "available", actor, 1, undefined, { trackOperation: true, idempotencyKey: "apply" });
      if (keyed) await updateEquipmentStatus(f.client, id, "available", actor, 1, undefined, { idempotencyKey: "other:noop" });
      else { await updateEquipmentStatus(f.client, id, "reserved", actor, 1); await updateEquipmentStatus(f.client, id, "available", actor, 1); }
      await expect(updateEquipmentStatus(f.client, id, "checked_out", actor, 1, undefined, { expectedOperationKey: "apply", idempotencyKey: "undo" })).rejects.toThrow("Equipment status changed");
      expect(f.status).toBe("available");
    }
  });
  it.each([{ expectedOperationKey: "" }, { expectedOperationKey: null }, { expectedOperationKey: "key\n" }, { trackOperation: "true" }])("rejects invalid ownership options before SQL %j", async bad => {
    const f = fixture(); await expect(updateEquipmentStatus(f.client, id, "reserved", actor, 1, undefined, bad as unknown as StatusChangeOptions)).rejects.toThrow(); expect(f.queries).toHaveLength(0);
  });
  it("persists exactly one history/request receipt and replays without reapplying", async () => {
    const f = fixture();
    expect(await updateEquipmentStatus(f.client, id, "checked_out", actor, 1, "pickup", options)).toEqual({ itemId: id, status: "checked_out", changed: true });
    f.setStatus("inspection_required");
    expect(await updateEquipmentStatus(f.client, id, "checked_out", actor, 1, "pickup", options)).toEqual({ itemId: id, status: "checked_out", changed: true, alreadyApplied: true });
    expect(f.status).toBe("inspection_required"); expect(f.history).toHaveLength(1);
    expect(f.queries.filter(q => q.sql.startsWith("UPDATE"))).toHaveLength(1);
    expect(f.queries.findIndex(q => q.sql.includes("pg_advisory_xact_lock"))).toBeLessThan(f.queries.findIndex(q => q.sql.includes("FOR UPDATE")));
  });
  it("canonicalizes expected sets, including order and duplicates", async () => {
    const f = fixture(); await updateEquipmentStatus(f.client, id, "checked_out", actor, 1, undefined, options);
    expect((await updateEquipmentStatus(f.client, id, "checked_out", actor, 1, undefined, { ...options, expectedStatus: ["reserved", "available", "available"] })).alreadyApplied).toBe(true);
  });
  it.each([
    { status: "under_maintenance" }, { reason: "different" }, { actor: "different-user" },
    { expectedStatus: ["available"] }, { item: other },
  ])("rejects key reuse with different inputs %j", async changed => {
    const f = fixture(); await updateEquipmentStatus(f.client, id, "checked_out", actor, 1, undefined, options);
    const change = changed as { status?: string; reason?: string; actor?: string; expectedStatus?: string[]; item?: string };
    await expect(updateEquipmentStatus(f.client, change.item ?? id, change.status ?? "checked_out", change.actor ?? actor, 1, change.reason, { ...options, expectedStatus: change.expectedStatus ?? options.expectedStatus })).rejects.toThrow("Idempotency key was already used");
    expect(f.history).toHaveLength(1); expect(f.status).toBe("checked_out");
  });
  it("persists keyed no-op receipts and replays the original changed:false result", async () => {
    const f = fixture();
    expect((await updateEquipmentStatus(f.client, id, "available", actor, 1, undefined, options)).changed).toBe(false);
    expect(f.history).toHaveLength(1); expect(f.history[0].old_status).toBe(f.history[0].new_status);
    f.setStatus("checked_out");
    expect(await updateEquipmentStatus(f.client, id, "available", actor, 1, undefined, options)).toEqual({ itemId: id, status: "available", changed: false, alreadyApplied: true });
    expect(f.status).toBe("checked_out"); expect(f.history).toHaveLength(1);
  });
  it("checks expected status under the lock, even on a no-op", async () => {
    const f = fixture();
    await expect(updateEquipmentStatus(f.client, id, "available", actor, 1, undefined, { ...options, expectedStatus: "checked_out" })).rejects.toThrow("Equipment status changed");
    expect(f.queries.some(q => q.sql.includes("FOR UPDATE"))).toBe(true);
    expect(f.queries.at(-1)?.sql).toBe("ROLLBACK"); expect(f.history).toHaveLength(0);
  });
  it("rolls back item and receipt writes when history fails", async () => {
    const f = fixture(); f.fail();
    await expect(updateEquipmentStatus(f.client, id, "checked_out", actor, 1, undefined, options)).rejects.toThrow("History failure");
    expect(f.status).toBe("available"); expect(f.history).toHaveLength(0);
    expect(f.queries.at(-1)?.sql).toBe("ROLLBACK");
  });
  it("does not expose another lab's receipt", async () => {
    const f = fixture(); await updateEquipmentStatus(f.client, id, "checked_out", actor, 1, undefined, options);
    await expect(updateEquipmentStatus(f.client, id, "checked_out", actor, 2, undefined, options)).rejects.toThrow("not found or access denied");
  });
  it("fails closed for legacy keyed history without fingerprints", async () => {
    const f = fixture(); await updateEquipmentStatus(f.client, id, "checked_out", actor, 1, undefined, options);
    f.history[0].request_fingerprint = null;
    await expect(updateEquipmentStatus(f.client, id, "checked_out", actor, 1, undefined, options)).rejects.toThrow("Idempotency key was already used");
  });
  it.each([{ expectedStatus: [] }, { expectedStatus: ["invalid"] }, { expectedStatus: 3 }, { idempotencyKey: "" }, { idempotencyKey: "line\n" }, { idempotencyKey: "a".repeat(129) }])("rejects malformed options before SQL %j", async bad => {
    const f = fixture();
    await expect(updateEquipmentStatus(f.client, id, "checked_out", actor, 1, undefined, bad as StatusChangeOptions)).rejects.toThrow();
    expect(f.queries).toHaveLength(0);
  });
});
