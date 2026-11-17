// S2-09 / C430PRJCT-40 handover Saga. Modeled database + Equipment port.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserIdentity } from "@unitrack/contracts";
import type { EquipmentStatus, ReturnStatusChange } from "../lib/returns/equipment-port";
import type { HandoverKitComponent } from "../lib/handover/equipment-port";
import { handoverDatabase, goodChecklist, reservationId, kitItemId, assistantId, borrowerId, labId, kitComponents, chargerId, otherLoanId } from "./fixtures/handover-db";
vi.mock("server-only", () => ({}));
const holder = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("../lib/db", () => ({ getDatabasePool: () => holder.pool }));
import { confirmHandover } from "../lib/handover/service";
import { getHandoverDetails } from "../lib/handover/queries";

let db: ReturnType<typeof handoverDatabase>;
let status: EquipmentStatus;
let owner: string | null;
let components: HandoverKitComponent[];
let loss: boolean, undoConflict: boolean;
let receipts: Map<string, { fingerprint: string; changed: boolean }>;
const calls: ReturnStatusChange[] = [];
const actor: UserIdentity = { kind: "user", sub: assistantId, role: "lab_assistant", lab_id: labId, rid: "handover-test" };
const equipment = {
  getItem: vi.fn(async (id: string, lab: number) => (id === kitItemId && lab === labId ? { id, name: "", labId, status } : null)),
  getKitComponents: vi.fn(async () => structuredClone(components)),
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
  db = handoverDatabase(); holder.pool = db.pool; status = "reserved"; owner = null; components = structuredClone(kitComponents);
  receipts = new Map(); calls.length = 0; loss = false; undoConflict = false;
  equipment.getItem.mockClear(); equipment.getKitComponents.mockClear(); equipment.changeStatus.mockClear();
});
const body = (conditions: unknown[] = goodChecklist(), studentConfirmed: unknown = true) => ({ studentConfirmed, conditions });
const confirm = (value: unknown = body(), identity = actor, id = reservationId) => confirmHandover(id, value, identity, equipment);
const nothingSaved = () => { expect(db.state.loans).toHaveLength(0); expect(db.state.records).toHaveLength(0); };

describe("acceptance criteria", () => {
  it("TC-3.1: five ticked Good components plus student confirmation -> Borrowed with borrower and due date", async () => {
    const result = await confirm();
    expect(result).toMatchObject({ reservationId, itemId: kitItemId, borrowerId, status: "checked_out", dueDate: db.state.reservation.end_at.toISOString() });
    expect(status).toBe("checked_out");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ itemId: kitItemId, status: "checked_out", expectedStatus: ["reserved"], changedBy: assistantId, idempotencyKey: expect.stringMatching(/^handover:[a-f0-9-]{36}:0:apply$/) });
    expect(db.state.loans).toEqual([expect.objectContaining({ id: result.loanId, item_id: kitItemId, borrower_id: borrowerId, reservation_id: reservationId, lab_id: labId, due_date: db.state.reservation.end_at, returned_at: null })]);
    expect(db.state.loans[0].student_confirmed_at).toEqual(new Date(result.studentConfirmedAt));
    // One pickup record for EVERY component, with actual IDs, phase pickup.
    expect(db.state.records).toHaveLength(5);
    expect(db.state.records.map(r => r.kit_component_id).sort()).toEqual(kitComponents.map(c => c.id).sort());
    expect(db.state.records.every(r => r.phase === "pickup" && r.condition_status === "good" && r.loan_id === result.loanId && r.item_id === kitItemId && r.recorded_by === assistantId && r.notes === null)).toBe(true);
    expect(db.state.reservation.handover_operation).toMatchObject({ state: "completed", result });
    const details = await getHandoverDetails(reservationId, labId);
    expect(details?.handover).toMatchObject({ loanId: result.loanId, dueDate: result.dueDate, studentConfirmedAt: result.studentConfirmedAt, returnedAt: null });
    expect(details?.handover?.pickupConditions).toHaveLength(5);
    expect(details?.pendingOperation).toBe(false);
  });

  it("renders dynamic component counts: a three-component kit needs exactly three rows", async () => {
    components = components.slice(0, 3);
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "A checked component does not belong to this equipment." });
    const result = await confirm(body(goodChecklist(components.map(c => c.id))));
    expect(db.state.records).toHaveLength(3); expect(result.status).toBe("checked_out");
  });

  it("TC-3.4: a missing charger is recorded missing with its note and is not marked present", async () => {
    const conditions = goodChecklist().map(row => row.kitComponentId === chargerId ? { ...row, conditionStatus: "missing", notes: "  Charger not in the case  " } : row);
    await confirm(body(conditions));
    const charger = db.state.records.find(r => r.kit_component_id === chargerId);
    expect(charger).toMatchObject({ condition_status: "missing", notes: "Charger not in the case", phase: "pickup" });
    expect(db.state.records.filter(r => r.condition_status === "good")).toHaveLength(4);
    expect(db.state.records).toHaveLength(5);
  });

  it("TC-3.5: existing damage is saved with its note and no photo is required", async () => {
    const conditions = goodChecklist().map(row => row.kitComponentId === kitComponents[3].id ? { ...row, conditionStatus: "damaged", notes: "Scratched lid" } : row);
    await confirm(body(conditions));
    expect(db.state.records.find(r => r.kit_component_id === kitComponents[3].id)).toMatchObject({ condition_status: "damaged", notes: "Scratched lid" });
  });

  it("stores Needs attention as unknown", async () => {
    await confirm(body(goodChecklist().map((row, i) => i === 1 ? { ...row, conditionStatus: "unknown", notes: "Loose connector" } : row)));
    expect(db.state.records.find(r => r.kit_component_id === kitComponents[1].id)).toMatchObject({ condition_status: "unknown", notes: "Loose connector" });
  });

  it.each([false, undefined, "true", 1])("TC-3.7: studentConfirmed=%s saves no loan, records or checkout and touches no service", async studentConfirmed => {
    const value = studentConfirmed === undefined ? { conditions: goodChecklist() } : body(goodChecklist(), studentConfirmed);
    await expect(confirm(value)).rejects.toMatchObject({ status: 400, code: studentConfirmed === false || studentConfirmed === undefined ? "student_confirmation_required" : "invalid_handover" });
    nothingSaved(); expect(status).toBe("reserved"); expect(db.sql).toHaveLength(0);
    expect(equipment.getItem).not.toHaveBeenCalled(); expect(equipment.changeStatus).not.toHaveBeenCalled();
    expect(db.state.reservation.handover_operation).toBeNull();
  });
});

describe("non-kit equipment", () => {
  it("saves one main-item pickup record (kit_component_id null) as Return expects", async () => {
    components = [];
    await confirm(body(goodChecklist([]).map(row => ({ ...row, conditionStatus: "damaged", notes: "Dent on base" }))));
    expect(db.state.records).toEqual([expect.objectContaining({ kit_component_id: null, item_id: kitItemId, phase: "pickup", condition_status: "damaged", notes: "Dent on base" })]);
  });
  it("rejects component rows for non-kit equipment and a main row for kits", async () => {
    components = [];
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "Record the condition of the equipment item." });
    components = structuredClone(kitComponents);
    await expect(confirm(body([...goodChecklist(), ...goodChecklist([])]))).rejects.toMatchObject({ status: 409 });
    nothingSaved(); expect(calls).toHaveLength(0);
  });
  it("treats a kit whose components are all inactive as the main item only", async () => {
    components = components.map(c => ({ ...c, isActive: false }));
    await confirm(body(goodChecklist([]))); expect(db.state.records[0].kit_component_id).toBeNull();
  });
});

describe("server-side checklist validation", () => {
  const unknownId = "7c9e6679-7425-40de-944b-e07fc1f900ff";
  it.each([
    ["an incomplete checklist", () => goodChecklist().slice(0, 4), 409, "Check every kit component listed for this equipment."],
    ["an unknown component", () => [...goodChecklist().slice(0, 4), { kitComponentId: unknownId, checked: true, conditionStatus: "good" }], 409, "A checked component does not belong to this equipment."],
    ["an unticked row", () => goodChecklist().map((row, i) => i === 2 ? { ...row, checked: false } : row), 409, "Tick every row after checking it."],
    ["a duplicate row", () => [...goodChecklist(), goodChecklist()[0]], 400, undefined],
    ["an invalid condition", () => goodChecklist().map((row, i) => i === 0 ? { ...row, conditionStatus: "broken" } : row), 400, undefined],
    ["a malformed component ID", () => goodChecklist().map((row, i) => i === 0 ? { ...row, kitComponentId: "charger" } : row), 400, undefined],
    ["notes over 1000 characters", () => goodChecklist().map((row, i) => i === 0 ? { ...row, notes: "x".repeat(1001) } : row), 400, undefined],
    ["a missing checked flag", () => goodChecklist().map(row => { const copy: Record<string, unknown> = { ...row }; delete copy.checked; return copy; }), 400, undefined],
    ["an empty checklist", () => [], 400, undefined],
  ])("rejects %s before any Equipment change", async (_name, rows, statusCode, message) => {
    await expect(confirm(body(rows()))).rejects.toMatchObject({ status: statusCode, ...(message ? { message } : {}) });
    nothingSaved(); expect(calls).toHaveLength(0); expect(status).toBe("reserved");
  });
  it("rejects inactive components even if submitted", async () => {
    components[4].isActive = false;
    await expect(confirm()).rejects.toMatchObject({ status: 409 });
    await confirm(body(goodChecklist(components.slice(0, 4).map(c => c.id)))); expect(db.state.records).toHaveLength(4);
  });
  it("accepts any row order and component ID letter case as the same checklist", async () => {
    const first = await confirm(body(goodChecklist().reverse()));
    expect(await confirm(body(goodChecklist().map(r => ({ ...r, kitComponentId: r.kitComponentId!.toUpperCase() }))))).toEqual(first);
  });
});

describe("eligibility and authorization", () => {
  it.each(["student", "professor", "lab_manager"] as const)("rejects %s before reading the database", async role => {
    await expect(confirm(body(), { ...actor, role })).rejects.toMatchObject({ status: 403 }); expect(db.sql).toHaveLength(0);
  });
  it("hides other labs' reservations", async () => {
    await expect(confirm(body(), { ...actor, lab_id: 8 })).rejects.toMatchObject({ status: 404, code: "reservation_not_found" });
    expect(await getHandoverDetails(reservationId, 8)).toBeNull();
  });
  it.each(["pending", "cancelled", "fulfilled", "expired"])("rejects a %s reservation", async reservationStatus => {
    db.state.reservation.status = reservationStatus;
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "Only confirmed reservations can be handed over." }); nothingSaved();
  });
  it("rejects outside the pickup window", async () => {
    db.state.reservation.start_at = new Date(Date.now() + 3600_000);
    await expect(confirm()).rejects.toMatchObject({ message: "The reservation pickup window has not started." });
    db.state.reservation.start_at = new Date(Date.now() - 7200_000); db.state.reservation.end_at = new Date(Date.now() - 1000);
    await expect(confirm()).rejects.toMatchObject({ message: "The reservation pickup window has ended." }); nothingSaved();
  });
  it.each(["checked_out", "overdue", "inspection_required", "under_maintenance", "retired", "lost"] as const)("rejects equipment in status %s", async current => {
    status = current; await expect(confirm()).rejects.toMatchObject({ status: 409 }); expect(calls).toHaveLength(0); nothingSaved();
  });
  it("accepts available equipment and expects that exact prior status", async () => {
    status = "available"; await confirm(); expect(calls[0].expectedStatus).toEqual(["available"]);
  });
  it("rejects an item already on another active loan and missing/cross-lab Equipment", async () => {
    db.state.loans.push({ id: otherLoanId, item_id: kitItemId, borrower_id: borrowerId, reservation_id: null, lab_id: labId, borrowed_at: new Date(), due_date: new Date(Date.now() + 1e6), student_confirmed_at: null, returned_at: null });
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "This equipment is already on loan." });
    db.state.loans.length = 0;
    equipment.getItem.mockResolvedValueOnce({ id: kitItemId, name: "", labId: 8, status: "reserved" });
    await expect(confirm()).rejects.toMatchObject({ status: 404, code: "equipment_missing" });
    equipment.getItem.mockResolvedValueOnce(null);
    await expect(confirm()).rejects.toMatchObject({ status: 404 }); expect(calls).toHaveLength(0);
  });
  it("rejects a reservation already handed over outside this workflow", async () => {
    db.state.loans.push({ id: otherLoanId, item_id: kitItemId, borrower_id: borrowerId, reservation_id: reservationId, lab_id: labId, borrowed_at: new Date(), due_date: new Date(Date.now() + 1e6), student_confirmed_at: null, returned_at: null });
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "This reservation has already been handed over." }); expect(calls).toHaveLength(0);
  });
});

describe("duplicates, concurrency and retries", () => {
  it("replays a completed handover (double click / retry) without a second loan, record or checkout", async () => {
    const first = await confirm();
    expect(await confirm()).toEqual(first);
    expect(db.state.loans).toHaveLength(1); expect(db.state.records).toHaveLength(5); expect(calls).toHaveLength(1);
  });
  it("rejects different checklist content or a different assistant after completion", async () => {
    await confirm();
    await expect(confirm(body(goodChecklist().map((r, i) => i ? r : { ...r, notes: "changed" })))).rejects.toMatchObject({ status: 409 });
    await expect(confirm(body(), { ...actor, sub: "7c9e6679-7425-40de-944b-e07fc1f900ee" })).rejects.toMatchObject({ status: 409 });
    expect(db.state.loans).toHaveLength(1);
  });
  it("serializes concurrent submissions: exactly one loan and one checkout", async () => {
    const results = await Promise.allSettled([confirm(), confirm(), confirm()]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(db.state.loans).toHaveLength(1); expect(db.state.records).toHaveLength(5); expect(calls).toHaveLength(1);
  });
  it("canonicalizes reservation ID spelling before taking the lock", async () => {
    const results = await Promise.allSettled([confirm(), confirm(body(), actor, reservationId.toUpperCase())]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(new Set(db.sql.filter(q => q.text.includes("pg_try_advisory_lock")).map(q => q.values[0])).size).toBe(1);
  });
});

describe("Loans-to-Equipment failures and recovery", () => {
  it("confirmed Equipment rejection saves nothing and reports a sanitized conflict", async () => {
    const { LoansError } = await import("../lib/errors");
    equipment.changeStatus.mockRejectedValueOnce(new LoansError(409, "equipment_rejected", "Equipment rejected the return operation. Verify its status before retrying."));
    await expect(confirm()).rejects.toMatchObject({ status: 409, code: "equipment_rejected", message: "Equipment rejected the handover. Verify its status before retrying." });
    nothingSaved(); expect(status).toBe("reserved");
    expect((await getHandoverDetails(reservationId, labId))?.pendingOperation).toBe(true);
  });
  it("maps an uncertain adapter failure to handover wording", async () => {
    const { uncertain } = await import("../lib/errors");
    equipment.getKitComponents.mockRejectedValueOnce(uncertain());
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" }); nothingSaved(); expect(calls).toHaveLength(0);
  });
  it("lost checkout response: no success reported, retry reuses the SAME key and completes once", async () => {
    loss = true;
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" });
    expect(status).toBe("checked_out"); nothingSaved();
    const result = await confirm();
    expect(calls).toHaveLength(2); expect(calls[0]).toEqual(calls[1]); expect(receipts.size).toBe(1);
    expect(db.state.loans).toHaveLength(1); expect(result.status).toBe("checked_out");
  });
  it("does not trust a replayed receipt when current Equipment status changed", async () => {
    loss = true; await expect(confirm()).rejects.toThrow(); status = "under_maintenance";
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" }); nothingSaved();
    expect(calls.every(c => !c.idempotencyKey.endsWith(":undo"))).toBe(true);
  });
  it("treats a keyed no-op receipt as needing reconciliation", async () => {
    equipment.changeStatus.mockResolvedValueOnce({ changed: false });
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" }); nothingSaved();
  });
  it.each(["loanFailure", "recordFailure"] as const)("%s: rolls back, restores Reserved with ownership guard, then retries with a fresh attempt key", async failure => {
    db.settings[failure] = true;
    await expect(confirm()).rejects.toMatchObject({ status: 503, code: "handover_rolled_back" });
    nothingSaved(); expect(status).toBe("reserved");
    expect(calls[1]).toMatchObject({ status: "reserved", expectedStatus: ["checked_out"], expectedOperationKey: calls[0].idempotencyKey, idempotencyKey: expect.stringMatching(/:0:undo$/) });
    db.settings[failure] = false;
    await confirm();
    expect(calls[2]).toMatchObject({ idempotencyKey: expect.stringMatching(/:1:apply$/), expectedOperationKey: calls[1].idempotencyKey });
    expect(db.state.loans).toHaveLength(1); expect(db.state.records).toHaveLength(5);
  });
  it("leaves a compensation conflict pending instead of overwriting Equipment", async () => {
    db.settings.recordFailure = true; undoConflict = true;
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" });
    expect(db.state.reservation.handover_operation).toMatchObject({ state: "compensating" }); expect(status).toBe("checked_out");
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" }); expect(calls[1].idempotencyKey).toBe(calls[2].idempotencyKey); nothingSaved();
  });
  it("blocks stale undo after another action took ownership of the status", async () => {
    db.settings.recordFailure = true; undoConflict = true;
    await expect(confirm()).rejects.toThrow();
    undoConflict = false; owner = "some-other-action";
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" }); expect(status).toBe("checked_out");
  });
  it.each(["before", "after"] as const)("never compensates an uncertain final COMMIT (%s) and reconciles on retry", async mode => {
    db.settings.commitFailure = mode;
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" }); expect(calls).toHaveLength(1);
    await confirm(); expect(db.state.loans).toHaveLength(1); expect(db.state.records).toHaveLength(5); expect(calls).toHaveLength(1);
  });
  it.each(["before", "after"] as const)("never contacts Equipment after an uncertain plan COMMIT (%s)", async mode => {
    db.settings.planCommitFailure = mode;
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" }); expect(calls).toHaveLength(0);
    await confirm(); expect(db.state.loans).toHaveLength(1);
  });
  it("does not compensate an unacknowledged rollback", async () => {
    db.settings.recordFailure = true; db.settings.rollbackFailure = true;
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" }); expect(calls).toHaveLength(1); expect(status).toBe("checked_out");
  });
  it("does not compensate when another writer recorded the loan", async () => {
    db.settings.recordFailure = true; db.settings.legacyLoanAfterRollback = true;
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" }); expect(calls).toHaveLength(1);
  });
  it("refuses to call Equipment when the durable plan write affects no row", async () => {
    db.settings.dropPlanWrite = true; await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" }); expect(calls).toHaveLength(0);
  });
  it("fails closed on a corrupted persisted operation", async () => {
    loss = true; await expect(confirm()).rejects.toThrow();
    (db.state.reservation.handover_operation as { state: string }).state = "unknown";
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" }); nothingSaved(); expect(calls).toHaveLength(1);
  });
});

describe("SC eligibility rules, at plan time and independently at final submission", () => {
  const otherId = "7c9e6679-7425-40de-944b-e07fc1f900b1";
  const overlapping = (patch: Partial<{ item_id: string; status: string; start_at: Date; end_at: Date }> = {}) => ({
    id: otherId, item_id: kitItemId, status: "confirmed", start_at: new Date(Date.now() - 1800_000), end_at: new Date(Date.now() + 3600_000), ...patch,
  });

  it("blocks when another confirmed reservation for the item is active at the same time", async () => {
    db.state.otherReservations.push(overlapping());
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "More than one reservation is eligible for this equipment right now. Ask staff to resolve the overlap." });
    expect(calls).toHaveLength(0); expect(equipment.getItem).not.toHaveBeenCalled(); nothingSaved();
  });
  it.each([
    ["pending", { status: "pending" }], ["cancelled", { status: "cancelled" }], ["fulfilled", { status: "fulfilled" }],
    ["future", { start_at: new Date(Date.now() + 3600_000), end_at: new Date(Date.now() + 7200_000) }],
    ["ended", { start_at: new Date(Date.now() - 7200_000), end_at: new Date(Date.now() - 1) }],
    ["another item's", { item_id: "7c9e6679-7425-40de-944b-e07fc1f900b2" }],
  ])("permits exactly one eligible reservation when the other is %s", async (_name, patch) => {
    db.state.otherReservations.push(overlapping(patch));
    expect((await confirm()).status).toBe("checked_out"); expect(db.state.loans).toHaveLength(1);
  });
  it("takes the per-item lock in both the plan and the final transaction", async () => {
    await confirm();
    const locks = db.sql.filter(q => q.text.includes("pg_advisory_xact_lock"));
    expect(locks).toHaveLength(2); expect(locks.every(q => q.values[0] === "loans:handover:item:" + kitItemId)).toBe(true);
  });
  it.each([
    ["reservation cancelled", () => { db.state.reservation.status = "cancelled"; }, "Only confirmed reservations can be handed over."],
    ["window ended", () => { db.state.reservation.end_at = new Date(Date.now() - 1); }, "The reservation pickup window has ended."],
    ["overlapping reservation confirmed", () => { db.state.otherReservations.push(overlapping()); }, "More than one reservation is eligible for this equipment right now. Ask staff to resolve the overlap."],
    ["another active loan created", () => { db.state.loans.push({ id: otherLoanId, item_id: kitItemId, borrower_id: borrowerId, reservation_id: null, lab_id: labId, borrowed_at: new Date(), due_date: new Date(Date.now() + 1e6), student_confirmed_at: null, returned_at: null }); }, "This equipment is already on loan."],
  ])("final submission re-verifies: %s after checkout -> 409, guarded undo, no loan", async (_name, change, message) => {
    db.settings.beforeFinalCheck = change;
    await expect(confirm()).rejects.toMatchObject({ status: 409, code: "handover_conflict", message });
    expect(calls).toHaveLength(2); expect(calls[1].idempotencyKey).toMatch(/:0:undo$/);
    expect(status).toBe("reserved");
    expect(db.state.loans.filter(l => l.reservation_id === reservationId)).toHaveLength(0); expect(db.state.records).toHaveLength(0);
    expect(db.state.reservation.handover_operation).toMatchObject({ state: "compensated" });
    // A retry is refused BEFORE contacting Equipment again (no checkout/undo churn).
    await expect(confirm()).rejects.toMatchObject({ status: 409, message }); expect(calls).toHaveLength(2);
  });
  it("a retried plan whose lost checkout committed is still re-verified and undone if now ineligible", async () => {
    loss = true; await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" });
    expect(status).toBe("checked_out");
    db.state.reservation.status = "cancelled";
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "Only confirmed reservations can be handed over." });
    // Same-key replay of the lost apply, then the ownership-guarded undo.
    expect(calls).toHaveLength(3); expect(calls[1]).toEqual(calls[0]);
    expect(calls[2]).toMatchObject({ status: "reserved", expectedStatus: ["checked_out"], expectedOperationKey: calls[0].idempotencyKey, idempotencyKey: expect.stringMatching(/:0:undo$/) });
    expect(status).toBe("reserved"); nothingSaved();
  });
  it("after an ineligible attempt is undone and the overlap is resolved, the same information completes", async () => {
    db.settings.beforeFinalCheck = () => { db.state.otherReservations.push(overlapping()); };
    await expect(confirm()).rejects.toMatchObject({ status: 409 });
    db.state.otherReservations.length = 0;
    const result = await confirm();
    expect(result.status).toBe("checked_out"); expect(calls[2].idempotencyKey).toMatch(/:1:apply$/); expect(db.state.loans).toHaveLength(1);
  });
});
