// S2-09 / C430PRJCT-40 handover Saga. Modeled database + Equipment/Users ports.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserIdentity } from "@unitrack/contracts";
import type { EquipmentStatus, ReturnStatusChange } from "../lib/returns/equipment-port";
import type { HandoverKitComponent } from "../lib/handover/equipment-port";
import { handoverDatabase, goodChecklist, checklistVersionFor, reservationId, kitItemId, assistantId, borrowerId, labId, kitComponents, chargerId, otherLoanId } from "./fixtures/handover-db";
vi.mock("server-only", () => ({}));
const holder = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("../lib/db", () => ({ getDatabasePool: () => holder.pool }));
import { confirmHandover, recoverHandover } from "../lib/handover/service";
import { getHandoverDetails, listInterruptedHandovers } from "../lib/handover/queries";
import { borrowerIneligible, borrowerUnavailable, borrowerUnverified } from "../lib/users-http";
import { LoansError, uncertain } from "../lib/errors";

let db: ReturnType<typeof handoverDatabase>;
let status: EquipmentStatus;
let owner: string | null;
let components: HandoverKitComponent[];
let loss: boolean, undoConflict: boolean;
let receipts: Map<string, { fingerprint: string; changed: boolean }>;
const calls: ReturnStatusChange[] = [];
const actor: UserIdentity = { kind: "user", sub: assistantId, role: "lab_assistant", lab_id: labId, rid: "handover-test" };
const otherAssistant: UserIdentity = { ...actor, sub: "7c9e6679-7425-40de-944b-e07fc1f900ee", rid: "other-assistant" };
const equipment = {
  getItem: vi.fn(async (id: string, lab: number) => (id === kitItemId && lab === labId ? { id, name: "", labId, status } : null)),
  getKitComponents: vi.fn(async () => structuredClone(components)),
  changeStatus: vi.fn(async (request: ReturnStatusChange) => {
    calls.push(request);
    if (undoConflict && request.idempotencyKey.endsWith(":undo")) throw new Error("Dummy compensation conflict");
    const fingerprint = JSON.stringify(request);
    const old = receipts.get(request.idempotencyKey);
    if (old) { if (old.fingerprint !== fingerprint) throw new Error("Dummy key misuse"); return { changed: old.changed }; }
    // Like the real HTTP adapter: Equipment's 409 (ownership/status conflict) is a confirmed rejection.
    if (request.expectedOperationKey !== undefined && request.expectedOperationKey !== owner) throw new LoansError(409, "equipment_rejected", "Equipment rejected the return operation. Verify its status before retrying.");
    if (!request.expectedStatus.includes(status)) throw new LoansError(409, "equipment_rejected", "Equipment rejected the return operation. Verify its status before retrying.");
    const changed = status !== request.status; status = request.status; owner = request.idempotencyKey;
    receipts.set(request.idempotencyKey, { fingerprint, changed });
    if (loss) { loss = false; throw new Error("Dummy lost response after committed Equipment change"); }
    return { changed };
  }),
};
// Users is the ONLY identity authority (adapter applies the PO rule: active,
// same-lab STUDENT matching the reservation's borrower_id).
const verified = { id: borrowerId, fullName: "Fixture Student", role: "student" as const, labId };
const users = { verifyBorrower: vi.fn(async (id: string, lab: number) => { if (id !== borrowerId) throw borrowerUnverified(); if (lab !== labId) throw borrowerIneligible(); return { ...verified, id }; }) };
const ports = { equipment, users };
beforeEach(() => {
  db = handoverDatabase(); holder.pool = db.pool; status = "reserved"; owner = null; components = structuredClone(kitComponents);
  receipts = new Map(); calls.length = 0; loss = false; undoConflict = false;
  equipment.getItem.mockClear(); equipment.getKitComponents.mockClear(); equipment.changeStatus.mockClear(); users.verifyBorrower.mockClear();
});
const versionNow = () => checklistVersionFor(kitItemId, components);
const body = (conditions: unknown[] = goodChecklist(), studentConfirmed: unknown = true, checklistVersion: unknown = versionNow(), universityIdVerified: unknown = true) => ({ universityIdVerified, studentConfirmed, checklistVersion, conditions });
const confirm = (value: unknown = body(), identity = actor, id = reservationId) => confirmHandover(id, value, identity, ports);
const recover = (identity = actor) => recoverHandover(reservationId, identity, ports);
const nothingSaved = () => { expect(db.state.loans).toHaveLength(0); expect(db.state.records).toHaveLength(0); };
const opState = () => (db.state.reservation.handover_operation as { state?: string } | null)?.state;
const componentRow = (id: string) => db.state.records.find(r => r.kit_component_id === id);
const mainRow = () => db.state.records.find(r => r.kit_component_id === null);

describe("acceptance criteria", () => {
  it("TC-3.1: main item + five ticked Good components + student confirmation -> Borrowed with six pickup records", async () => {
    const result = await confirm();
    expect(result).toMatchObject({ reservationId, itemId: kitItemId, borrowerId, status: "checked_out", dueDate: db.state.reservation.end_at.toISOString() });
    expect(status).toBe("checked_out");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ itemId: kitItemId, status: "checked_out", expectedStatus: ["reserved"], changedBy: assistantId, idempotencyKey: expect.stringMatching(/^handover:[a-f0-9-]{36}:0:apply$/) });
    expect(db.state.loans).toEqual([expect.objectContaining({ id: result.loanId, item_id: kitItemId, borrower_id: borrowerId, reservation_id: reservationId, lab_id: labId, due_date: db.state.reservation.end_at, returned_at: null })]);
    expect(db.state.loans[0].student_confirmed_at).toEqual(new Date(result.studentConfirmedAt));
    // One MAIN-ITEM record plus one per component, actual IDs, phase pickup.
    expect(db.state.records).toHaveLength(6);
    expect(db.state.records.map(r => r.kit_component_id).sort()).toEqual([null, ...kitComponents.map(c => c.id)].sort());
    expect(db.state.records.every(r => r.phase === "pickup" && r.condition_status === "good" && r.loan_id === result.loanId && r.item_id === kitItemId && r.recorded_by === assistantId && r.notes === null)).toBe(true);
    expect(db.state.reservation.handover_operation).toMatchObject({ state: "completed", result });
    const details = await getHandoverDetails(reservationId, labId, assistantId);
    expect(details?.handover).toMatchObject({ loanId: result.loanId, dueDate: result.dueDate, studentConfirmedAt: result.studentConfirmedAt, returnedAt: null });
    expect(details?.handover?.pickupConditions).toHaveLength(6);
    expect(details?.pending).toBeNull();
  });

  it("records the main item's OWN condition, never inferred from components", async () => {
    await confirm(body(goodChecklist().map(row => row.kitComponentId === null ? { ...row, conditionStatus: "damaged", notes: "Case hinge cracked" } : row)));
    expect(mainRow()).toMatchObject({ condition_status: "damaged", notes: "Case hinge cracked" });
    expect(db.state.records.filter(r => r.kit_component_id !== null).every(r => r.condition_status === "good")).toBe(true);
  });

  it("renders dynamic component counts: a three-component kit needs main + three rows", async () => {
    components = components.slice(0, 3);
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "A checked component does not belong to this equipment." });
    const result = await confirm(body(goodChecklist(components.map(c => c.id))));
    expect(db.state.records).toHaveLength(4); expect(result.status).toBe("checked_out");
  });

  it("TC-3.4: a missing charger is recorded missing with its note and is not marked present", async () => {
    const conditions = goodChecklist().map(row => row.kitComponentId === chargerId ? { ...row, conditionStatus: "missing", notes: "  Charger not in the case  " } : row);
    await confirm({ ...body(conditions), acknowledgedMissing: [chargerId] });
    expect(componentRow(chargerId)).toMatchObject({ condition_status: "missing", notes: "Charger not in the case", phase: "pickup" });
    expect(db.state.records.filter(r => r.condition_status === "good")).toHaveLength(5);
    expect(db.state.records).toHaveLength(6);
  });

  it("TC-3.5: existing damage is saved with its note and no photo is required", async () => {
    const conditions = goodChecklist().map(row => row.kitComponentId === kitComponents[3].id ? { ...row, conditionStatus: "damaged", notes: "Scratched lid" } : row);
    await confirm(body(conditions));
    expect(componentRow(kitComponents[3].id)).toMatchObject({ condition_status: "damaged", notes: "Scratched lid" });
  });

  it("stores Needs attention as unknown", async () => {
    await confirm(body(goodChecklist().map(row => row.kitComponentId === kitComponents[1].id ? { ...row, conditionStatus: "unknown", notes: "Loose connector" } : row)));
    expect(componentRow(kitComponents[1].id)).toMatchObject({ condition_status: "unknown", notes: "Loose connector" });
  });

  it.each([false, undefined, "true", 1])("TC-3.7: studentConfirmed=%s saves no loan, records or checkout and touches no service", async studentConfirmed => {
    const value = studentConfirmed === undefined ? { universityIdVerified: true, checklistVersion: versionNow(), conditions: goodChecklist() } : body(goodChecklist(), studentConfirmed);
    await expect(confirm(value)).rejects.toMatchObject({ status: 400, code: studentConfirmed === false || studentConfirmed === undefined ? "student_confirmation_required" : "invalid_handover" });
    nothingSaved(); expect(status).toBe("reserved"); expect(db.sql).toHaveLength(0);
    expect(equipment.getItem).not.toHaveBeenCalled(); expect(equipment.changeStatus).not.toHaveBeenCalled(); expect(users.verifyBorrower).not.toHaveBeenCalled();
    expect(db.state.reservation.handover_operation).toBeNull();
  });
});

describe("non-kit equipment and kit shape", () => {
  it("non-kit: saves exactly one main-item pickup record (kit_component_id null)", async () => {
    components = [];
    await confirm(body(goodChecklist([]).map(row => ({ ...row, conditionStatus: "damaged", notes: "Dent on base" }))));
    expect(db.state.records).toEqual([expect.objectContaining({ kit_component_id: null, item_id: kitItemId, phase: "pickup", condition_status: "damaged", notes: "Dent on base" })]);
  });
  it("rejects component rows for non-kit equipment and a kit checklist without the main item", async () => {
    components = [];
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "Record the condition of the equipment item." });
    components = structuredClone(kitComponents);
    await expect(confirm(body(goodChecklist().slice(1)))).rejects.toMatchObject({ status: 409, message: "Record the condition of the main item as well as every component." });
    nothingSaved(); expect(calls).toHaveLength(0);
  });
  it("treats a kit whose components are all inactive as the main item only", async () => {
    components = components.map(c => ({ ...c, isActive: false }));
    await confirm(body(goodChecklist([]))); expect(db.state.records).toHaveLength(1); expect(mainRow()).toBeDefined();
  });
});

describe("server-side checklist validation", () => {
  const unknownId = "7c9e6679-7425-40de-944b-e07fc1f900ff";
  it.each([
    ["an incomplete checklist", () => goodChecklist().slice(0, 4), 409, "Check every kit component listed for this equipment."],
    ["an unknown component", () => [...goodChecklist().slice(0, 4), { kitComponentId: unknownId, checked: true, conditionStatus: "good" }], 409, "A checked component does not belong to this equipment."],
    ["an unticked component row", () => goodChecklist().map((row, i) => i === 2 ? { ...row, checked: false } : row), 409, "Tick every row after checking it."],
    ["an unticked main-item row", () => goodChecklist().map(row => row.kitComponentId === null ? { ...row, checked: false } : row), 409, "Tick every row after checking it."],
    ["a duplicate row", () => [...goodChecklist(), goodChecklist()[1]], 400, undefined],
    ["a duplicate main-item row", () => [...goodChecklist(), goodChecklist()[0]], 400, undefined],
    ["an invalid condition", () => goodChecklist().map((row, i) => i === 0 ? { ...row, conditionStatus: "broken" } : row), 400, undefined],
    ["a malformed component ID", () => goodChecklist().map((row, i) => i === 1 ? { ...row, kitComponentId: "charger" } : row), 400, undefined],
    ["notes over 1000 characters", () => goodChecklist().map((row, i) => i === 0 ? { ...row, notes: "x".repeat(1001) } : row), 400, undefined],
    ["a missing checked flag", () => goodChecklist().map(row => { const copy: Record<string, unknown> = { ...row }; delete copy.checked; return copy; }), 400, undefined],
    ["an empty checklist", () => [], 400, undefined],
  ])("rejects %s before any Equipment change", async (_name, rows, statusCode, message) => {
    await expect(confirm(body(rows()))).rejects.toMatchObject({ status: statusCode, ...(message ? { message } : {}) });
    nothingSaved(); expect(calls).toHaveLength(0); expect(status).toBe("reserved");
  });
  it.each([undefined, "", "not-a-version", "A".repeat(64)])("rejects a missing or malformed checklist version (%s)", async version => {
    const value: Record<string, unknown> = { universityIdVerified: true, studentConfirmed: true, conditions: goodChecklist() };
    if (version !== undefined) value.checklistVersion = version;
    await expect(confirm(value)).rejects.toMatchObject({ status: 400, code: "invalid_handover" }); expect(db.sql).toHaveLength(0);
  });
  it("rejects inactive components even if submitted", async () => {
    components[4].isActive = false;
    await expect(confirm()).rejects.toMatchObject({ status: 409 });
    await confirm(body(goodChecklist(components.slice(0, 4).map(c => c.id)))); expect(db.state.records).toHaveLength(5);
  });
  it("accepts any row order and component ID letter case as the same checklist", async () => {
    const first = await confirm(body(goodChecklist().reverse()));
    expect(await confirm(body(goodChecklist().map(r => ({ ...r, kitComponentId: r.kitComponentId?.toUpperCase() ?? null }))))).toEqual(first);
  });
});

describe("eligibility and authorization", () => {
  it.each(["student", "professor", "lab_manager"] as const)("rejects %s before reading the database", async role => {
    await expect(confirm(body(), { ...actor, role })).rejects.toMatchObject({ status: 403 });
    await expect(recover({ ...actor, role })).rejects.toMatchObject({ status: 403 }); expect(db.sql).toHaveLength(0);
  });
  it("hides other labs' reservations", async () => {
    await expect(confirm(body(), { ...actor, lab_id: 8 })).rejects.toMatchObject({ status: 404, code: "reservation_not_found" });
    expect(await getHandoverDetails(reservationId, 8, assistantId)).toBeNull();
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

describe("student identity verification through Users", () => {
  it("verifies the reservation's borrower (not any client value) before checkout and again before saving", async () => {
    await confirm({ ...body(), borrowerId: "7c9e6679-7425-40de-944b-e07fc1f900aa", borrowerName: "Someone Else" });
    expect(users.verifyBorrower.mock.calls).toEqual([[borrowerId, labId], [borrowerId, labId]]);
    expect(db.state.loans[0].borrower_id).toBe(borrowerId);
  });
  it("refuses an unknown or inactive borrower before any Equipment change", async () => {
    users.verifyBorrower.mockRejectedValueOnce(borrowerUnverified());
    await expect(confirm()).rejects.toMatchObject({ status: 409, code: "borrower_unverified" });
    expect(calls).toHaveLength(0); nothingSaved(); expect(db.state.reservation.handover_operation).toBeNull();
  });
  it("fails closed and retryable when Users is unavailable before checkout", async () => {
    users.verifyBorrower.mockRejectedValueOnce(borrowerUnavailable());
    await expect(confirm()).rejects.toMatchObject({ status: 503, code: "borrower_unavailable" });
    expect(calls).toHaveLength(0); nothingSaved(); expect(db.state.reservation.handover_operation).toBeNull();
    expect((await confirm()).status).toBe("checked_out");
  });
  it("a borrower deactivated after checkout: undo with ownership guard, 409, no loan", async () => {
    users.verifyBorrower.mockResolvedValueOnce(verified).mockRejectedValueOnce(borrowerUnverified());
    await expect(confirm()).rejects.toMatchObject({ status: 409, code: "borrower_unverified" });
    expect(calls[1]).toMatchObject({ idempotencyKey: expect.stringMatching(/:0:undo$/), expectedOperationKey: calls[0].idempotencyKey });
    expect(status).toBe("reserved"); nothingSaved(); expect(opState()).toBe("compensated");
  });
  it("Users unavailable after checkout: no false success, durable 'applied' plan, recovery completes later", async () => {
    users.verifyBorrower.mockResolvedValueOnce(verified).mockRejectedValueOnce(borrowerUnavailable());
    await expect(confirm()).rejects.toMatchObject({ status: 503, code: "handover_incomplete" });
    expect(status).toBe("checked_out"); nothingSaved(); expect(opState()).toBe("applied");
    const result = await recover();
    expect(result.status).toBe("checked_out"); expect(db.state.records).toHaveLength(6); expect(calls).toHaveLength(1);
  });
});

describe("kit membership / component changes", () => {
  it("rejects a checklist loaded before the component list changed, before any Equipment change", async () => {
    const staleVersion = versionNow();
    components = [...components, { id: "7c9e6679-7425-40de-944b-e07fc1f900a9", name: "Spare battery", isActive: true, isRequired: false }];
    await expect(confirm(body(goodChecklist(kitComponents.map(c => c.id)), true, staleVersion))).rejects.toMatchObject({ status: 409, message: "The equipment's component list changed. Reload the checklist and check it again." });
    expect(calls).toHaveLength(0); nothingSaved();
  });
  it.each([
    ["renamed", () => { components[0] = { ...components[0], name: "USB-C charger" }; }],
    ["deactivated", () => { components[4] = { ...components[4], isActive: false }; }],
    ["required flag changed", () => { components[2] = { ...components[2], isRequired: false }; }],
  ])("detects a component %s between loading and submitting", async (_name, change) => {
    const staleVersion = versionNow(); change();
    await expect(confirm(body(goodChecklist(), true, staleVersion))).rejects.toMatchObject({ status: 409 }); expect(calls).toHaveLength(0);
  });
  it("components change after checkout: never saves stale records; undo restores Reserved", async () => {
    equipment.getKitComponents.mockResolvedValueOnce(structuredClone(components)).mockResolvedValueOnce(structuredClone(components.slice(0, 4)));
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "The equipment's component list changed. Reload the checklist and check it again." });
    expect(status).toBe("reserved"); nothingSaved(); expect(calls.map(c => c.idempotencyKey.split(":").slice(-1)[0])).toEqual(["apply", "undo"]);
  });
  it("Equipment components unavailable after checkout: incomplete, recoverable", async () => {
    equipment.getKitComponents.mockResolvedValueOnce(structuredClone(components)).mockRejectedValueOnce(uncertain());
    await expect(confirm()).rejects.toMatchObject({ code: "handover_incomplete" }); expect(opState()).toBe("applied"); nothingSaved();
    await recover(); expect(db.state.records).toHaveLength(6);
  });
});

describe("interrupted handovers: durable recovery without the browser", () => {
  it("lost checkout response, browser closed: the starter finishes from the stored plan (no checklist resent)", async () => {
    const conditions = goodChecklist().map(row => row.kitComponentId === chargerId ? { ...row, conditionStatus: "missing", notes: "Charger not in the case" } : row);
    loss = true; await expect(confirm({ ...body(conditions), acknowledgedMissing: [chargerId] })).rejects.toMatchObject({ code: "handover_state_uncertain" });
    expect(status).toBe("checked_out"); nothingSaved();
    const details = await getHandoverDetails(reservationId, labId, assistantId);
    expect(details?.pending).toMatchObject({ state: "planned", recoverableByYou: true });
    expect(await listInterruptedHandovers(labId, assistantId)).toEqual([expect.objectContaining({ reservationId, state: "planned", recoverableByYou: true })]);
    const result = await recover();
    expect(result.status).toBe("checked_out"); expect(calls[1]).toEqual(calls[0]); expect(receipts.size).toBe(1);
    expect(componentRow(chargerId)).toMatchObject({ condition_status: "missing", notes: "Charger not in the case" });
    expect(await listInterruptedHandovers(labId, assistantId)).toEqual([]);
  });
  it("a confirmed checkout ('applied') can be finished by ANY same-lab assistant; records keep the original recorder", async () => {
    users.verifyBorrower.mockResolvedValueOnce(verified).mockRejectedValueOnce(borrowerUnavailable());
    await expect(confirm()).rejects.toMatchObject({ code: "handover_incomplete" });
    expect((await getHandoverDetails(reservationId, labId, otherAssistant.sub))?.pending).toMatchObject({ state: "applied", recoverableByYou: true });
    await recoverHandover(reservationId, otherAssistant, ports);
    expect(db.state.loans).toHaveLength(1); expect(db.state.records.every(r => r.recorded_by === assistantId)).toBe(true); expect(calls).toHaveLength(1);
  });
  it("an uncertain checkout ('planned') can only be finished by the starting assistant", async () => {
    loss = true; await expect(confirm()).rejects.toThrow();
    expect((await getHandoverDetails(reservationId, labId, otherAssistant.sub))?.pending).toMatchObject({ state: "planned", recoverableByYou: false });
    await expect(recoverHandover(reservationId, otherAssistant, ports)).rejects.toMatchObject({ status: 409, message: "Only the assistant who started this handover can finish or undo it. Ask them, or ask a lab manager to reconcile." });
    expect(calls).toHaveLength(1);
  });
  it("another assistant finding a now-ineligible applied plan cannot undo; the starter's recovery undoes it", async () => {
    users.verifyBorrower.mockResolvedValueOnce(verified).mockRejectedValueOnce(borrowerUnavailable());
    await expect(confirm()).rejects.toMatchObject({ code: "handover_incomplete" });
    db.state.reservation.status = "cancelled";
    await expect(recoverHandover(reservationId, otherAssistant, ports)).rejects.toMatchObject({ status: 409, message: "Only confirmed reservations can be handed over." });
    expect(opState()).toBe("applied"); expect(status).toBe("checked_out"); expect(calls).toHaveLength(1);
    await expect(recover()).rejects.toMatchObject({ status: 409 });
    expect(status).toBe("reserved"); expect(opState()).toBe("compensated"); nothingSaved();
    await expect(recover()).rejects.toMatchObject({ message: "The interrupted handover was undone and the equipment restored. Start a new handover with the student present." });
  });
  it("blocks a different new checklist while an earlier one is unfinished, then allows it once that is undone", async () => {
    users.verifyBorrower.mockResolvedValueOnce(verified).mockRejectedValueOnce(borrowerUnavailable());
    await expect(confirm()).rejects.toMatchObject({ code: "handover_incomplete" });
    const different = body(goodChecklist().map(r => r.kitComponentId === null ? { ...r, notes: "second attempt" } : r));
    await expect(confirm(different)).rejects.toMatchObject({ status: 409, message: "Another handover for this reservation is unfinished. Use Finish interrupted handover first." });
    db.settings.recordFailure = true; await expect(recover()).rejects.toMatchObject({ code: "handover_rolled_back" }); db.settings.recordFailure = false;
    expect(opState()).toBe("compensated"); expect(status).toBe("reserved");
    const result = await confirm(different);
    expect(result.status).toBe("checked_out"); expect(mainRow()?.notes).toBe("second attempt");
    expect(calls.at(-1)?.idempotencyKey).toMatch(/:0:apply$/); expect(calls.at(-1)?.idempotencyKey).not.toBe(calls[0].idempotencyKey);
  });
  it("recovery when nothing is unfinished, or after completion, writes nothing", async () => {
    await expect(recover()).rejects.toMatchObject({ status: 404, code: "handover_not_pending" });
    const result = await confirm();
    expect(await recover()).toEqual(result); expect(calls).toHaveLength(1); expect(db.state.loans).toHaveLength(1);
  });
  it("a compensation stuck on an ownership conflict stays visible and never overwrites Equipment", async () => {
    db.settings.recordFailure = true; undoConflict = true;
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" });
    expect((await getHandoverDetails(reservationId, labId, assistantId))?.pending).toMatchObject({ state: "compensating" });
    await expect(recover()).rejects.toMatchObject({ code: "handover_state_uncertain" }); expect(status).toBe("checked_out");
    await expect(recoverHandover(reservationId, otherAssistant, ports)).rejects.toMatchObject({ status: 409 });
  });
});

describe("duplicates, concurrency and retries", () => {
  it("replays a completed handover (double click / retry) without a second loan, record or checkout", async () => {
    const first = await confirm();
    expect(await confirm()).toEqual(first);
    expect(db.state.loans).toHaveLength(1); expect(db.state.records).toHaveLength(6); expect(calls).toHaveLength(1);
  });
  it("rejects different checklist content or a different assistant after completion", async () => {
    await confirm();
    await expect(confirm(body(goodChecklist().map((r, i) => i ? r : { ...r, notes: "changed" })))).rejects.toMatchObject({ status: 409 });
    await expect(confirm(body(), otherAssistant)).rejects.toMatchObject({ status: 409 });
    expect(db.state.loans).toHaveLength(1);
  });
  it("serializes concurrent submissions and recoveries: exactly one loan and one checkout", async () => {
    const results = await Promise.allSettled([confirm(), confirm(), recover(), confirm()]);
    expect(results.filter(r => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(db.state.loans).toHaveLength(1); expect(db.state.records).toHaveLength(6); expect(calls).toHaveLength(1);
  });
  it("canonicalizes reservation ID spelling before taking the lock", async () => {
    const results = await Promise.allSettled([confirm(), confirm(body(), actor, reservationId.toUpperCase())]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(new Set(db.sql.filter(q => q.text.includes("pg_try_advisory_lock")).map(q => q.values[0])).size).toBe(1);
  });
});

describe("Loans-to-Equipment failures and recovery", () => {
  it("confirmed Equipment rejection saves nothing and reports a sanitized conflict", async () => {
    equipment.changeStatus.mockRejectedValueOnce(new LoansError(409, "equipment_rejected", "Equipment rejected the return operation. Verify its status before retrying."));
    await expect(confirm()).rejects.toMatchObject({ status: 409, code: "equipment_rejected", message: "Equipment rejected the handover. Verify its status before retrying." });
    nothingSaved(); expect(status).toBe("reserved");
    expect((await getHandoverDetails(reservationId, labId, assistantId))?.pending).toMatchObject({ state: "planned" });
  });
  it("maps an uncertain adapter failure to handover wording", async () => {
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
    expect(db.state.loans).toHaveLength(1); expect(db.state.records).toHaveLength(6);
  });
  it("leaves a compensation conflict pending instead of overwriting Equipment", async () => {
    db.settings.recordFailure = true; undoConflict = true;
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" });
    expect(opState()).toBe("compensating"); expect(status).toBe("checked_out");
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
    await confirm(); expect(db.state.loans).toHaveLength(1); expect(db.state.records).toHaveLength(6); expect(calls).toHaveLength(1);
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
  it("fails closed on a corrupted persisted operation (state or stored checklist)", async () => {
    loss = true; await expect(confirm()).rejects.toThrow();
    const op = db.state.reservation.handover_operation as { state: string; conditions: unknown };
    const saved = op.conditions; op.conditions = [{ kitComponentId: null, checked: false }];
    await expect(recover()).rejects.toMatchObject({ code: "handover_state_uncertain" });
    op.conditions = saved; op.state = "unknown";
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
  it("takes the common per-item lock BEFORE the reservation row lock, in the plan and the final transaction", async () => {
    await confirm();
    const locks = db.sql.filter(q => q.text.includes("pg_advisory_xact_lock"));
    expect(locks).toHaveLength(2); expect(locks.every(q => q.values[0] === "loans:item:" + kitItemId)).toBe(true);
    const rowLocks = db.sql.map((q, i) => [q, i] as const).filter(([q]) => q.text.includes("for update"));
    expect(rowLocks).toHaveLength(2);
    for (const [, index] of rowLocks) {
      // Within the same transaction, the item lock precedes the row lock.
      const before = db.sql.slice(0, index).reverse();
      expect(before.findIndex(q => q.text.includes("pg_advisory_xact_lock"))).toBeLessThan(before.findIndex(q => q.text === "BEGIN"));
    }
    // The per-reservation lock is a non-blocking SESSION lock, released at the end.
    expect(db.sql.filter(q => q.text.includes("pg_try_advisory_lock")).map(q => q.values[0])).toEqual(["loans:handover:" + reservationId]);
    expect(db.sql.at(-1)).toMatchObject({ text: expect.stringContaining("pg_advisory_unlock"), values: ["loans:handover:" + reservationId] });
  });
  it.each([
    ["reservation cancelled", () => { db.state.reservation.status = "cancelled"; }, "Only confirmed reservations can be handed over."],
    ["confirmed end date edited into the past", () => { db.state.reservation.end_at = new Date(Date.now() - 1); }, "The reservation changed during handover. Reload and check it again."],
    ["overlapping reservation confirmed", () => { db.state.otherReservations.push(overlapping()); }, "More than one reservation is eligible for this equipment right now. Ask staff to resolve the overlap."],
    ["another active loan created", () => { db.state.loans.push({ id: otherLoanId, item_id: kitItemId, borrower_id: borrowerId, reservation_id: null, lab_id: labId, borrowed_at: new Date(), due_date: new Date(Date.now() + 1e6), student_confirmed_at: null, returned_at: null }); }, "This equipment is already on loan."],
    ["borrower changed on the reservation", () => { db.state.reservation.borrower_id = "7c9e6679-7425-40de-944b-e07fc1f900cc"; }, "The reservation changed during handover. Reload and check it again."],
  ])("final submission re-verifies: %s after checkout -> 409, guarded undo, no loan", async (_name, change, message) => {
    db.settings.beforeFinalCheck = change;
    await expect(confirm()).rejects.toMatchObject({ status: 409, code: "handover_conflict", message });
    expect(calls).toHaveLength(2); expect(calls[1].idempotencyKey).toMatch(/:0:undo$/);
    expect(status).toBe("reserved");
    expect(db.state.loans.filter(l => l.reservation_id === reservationId)).toHaveLength(0); expect(db.state.records).toHaveLength(0);
    expect(opState()).toBe("compensated");
    // A retry is refused BEFORE contacting Equipment again (no checkout/undo churn).
    await expect(confirm()).rejects.toMatchObject({ status: 409 }); expect(calls).toHaveLength(2);
  });
  it("final submission re-verifies: the pickup window ends (time passes, dates unchanged) after checkout -> 409, undo, no loan", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      db.settings.beforeFinalCheck = () => { vi.setSystemTime(new Date(db.state.reservation.end_at.getTime() + 1)); };
      await expect(confirm()).rejects.toMatchObject({ status: 409, message: "The reservation pickup window has ended." });
      expect(calls.map(c => c.idempotencyKey.split(":").at(-1))).toEqual(["apply", "undo"]); expect(status).toBe("reserved"); nothingSaved();
    } finally { vi.useRealTimers(); }
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

describe("PO decision A1 (ZZ): missing components must be disclosed in the student's confirmation", () => {
  const missingCharger = () => goodChecklist().map(row => row.kitComponentId === chargerId ? { ...row, conditionStatus: "missing", notes: "Charger not in the case" } : row);
  it("refuses a missing component the confirmation did not include, before any access", async () => {
    await expect(confirm(body(missingCharger()))).rejects.toMatchObject({ status: 400, code: "student_confirmation_required", message: "The student's confirmation must include every item recorded as missing. Ask the student to confirm again." });
    expect(db.sql).toHaveLength(0); expect(equipment.getItem).not.toHaveBeenCalled(); expect(users.verifyBorrower).not.toHaveBeenCalled(); nothingSaved();
  });
  it.each([
    ["a different component", () => [kitComponents[1].id]],
    ["an extra component", () => [chargerId, kitComponents[1].id]],
    ["a malformed entry", () => ["charger"]],
  ])("refuses an acknowledgement listing %s", async (_name, list) => {
    await expect(confirm({ ...body(missingCharger()), acknowledgedMissing: list() })).rejects.toMatchObject({ status: 400 });
    expect(db.sql).toHaveLength(0); nothingSaved();
  });
  it("refuses an acknowledgement of a missing item when nothing is recorded missing", async () => {
    await expect(confirm({ ...body(), acknowledgedMissing: [chargerId] })).rejects.toMatchObject({ code: "student_confirmation_required" }); nothingSaved();
  });
  it("proceeds when the confirmation includes the missing component; saves it missing with its note", async () => {
    const result = await confirm({ ...body(missingCharger()), acknowledgedMissing: [chargerId.toUpperCase()] });
    expect(result.status).toBe("checked_out");
    expect(componentRow(chargerId)).toMatchObject({ condition_status: "missing", notes: "Charger not in the case" });
    expect(db.state.loans[0].student_confirmed_at).toBeInstanceOf(Date);
  });
  it("covers a REQUIRED component and a missing main item too", async () => {
    expect(kitComponents[0].isRequired).toBe(true);
    const conditions = missingCharger().map(row => row.kitComponentId === null ? { ...row, conditionStatus: "missing", notes: "Only accessories present" } : row);
    await confirm({ ...body(conditions), acknowledgedMissing: [null, chargerId] });
    expect(mainRow()).toMatchObject({ condition_status: "missing", notes: "Only accessories present" });
  });
  it("without confirmation, nothing is saved even when the missing item was acknowledged", async () => {
    await expect(confirm({ ...body(missingCharger(), false), acknowledgedMissing: [chargerId] })).rejects.toMatchObject({ code: "student_confirmation_required" });
    expect(db.sql).toHaveLength(0); nothingSaved(); expect(status).toBe("reserved");
  });
  it("binds the acknowledgement into the replay fingerprint", async () => {
    const first = await confirm({ ...body(missingCharger()), acknowledgedMissing: [chargerId] });
    expect(await confirm({ ...body(missingCharger()), acknowledgedMissing: [chargerId] })).toEqual(first);
    expect(calls).toHaveLength(1);
  });
});

describe("PO decision A2 (ZZ): eligible reservations may be handed over while Available, without duplicate checkout", () => {
  beforeEach(() => { status = "available"; });
  it("hands over Available equipment with expectedStatus [available] and one keyed checkout", async () => {
    const result = await confirm();
    expect(result.status).toBe("checked_out"); expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ expectedStatus: ["available"], status: "checked_out" });
  });
  it("rechecks eligibility at submission: an active loan blocks it", async () => {
    db.state.loans.push({ id: otherLoanId, item_id: kitItemId, borrower_id: borrowerId, reservation_id: null, lab_id: labId, borrowed_at: new Date(), due_date: new Date(Date.now() + 1e6), student_confirmed_at: null, returned_at: null });
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "This equipment is already on loan." }); expect(calls).toHaveLength(0);
  });
  it("a concurrent status change between validation and checkout is rejected by Equipment; no loan", async () => {
    // Someone else checks the item out after Loans validated it as Available.
    equipment.getKitComponents.mockImplementationOnce(async () => { status = "checked_out"; return structuredClone(components); });
    await expect(confirm()).rejects.toMatchObject({ status: 409, code: "equipment_rejected" });
    expect(db.state.loans).toHaveLength(0);
  });
  it("concurrent submissions for the same Available reservation check it out once", async () => {
    const results = await Promise.allSettled([confirm(), confirm(), confirm()]);
    expect(results.filter(r => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(calls).toHaveLength(1); expect(db.state.loans).toHaveLength(1);
  });
  it("a second eligible reservation for the same Available item blocks handover", async () => {
    db.state.otherReservations.push({ id: "7c9e6679-7425-40de-944b-e07fc1f900b1", item_id: kitItemId, status: "confirmed", start_at: new Date(Date.now() - 60_000), end_at: new Date(Date.now() + 3600_000) });
    await expect(confirm()).rejects.toMatchObject({ status: 409 }); expect(calls).toHaveLength(0);
  });
});

describe("PO decisions (JS): borrower eligibility, physical university-ID check, recovery and confirmed dates", () => {
  it.each([false, undefined, null])("no university-ID check (%s) -> 400 id_verification_required before any access", async idCheck => {
    const value: Record<string, unknown> = body(); if (idCheck === undefined) delete value.universityIdVerified; else value.universityIdVerified = idCheck;
    await expect(confirm(value)).rejects.toMatchObject(idCheck === null ? { status: 400, code: "invalid_handover" } : { status: 400, code: "id_verification_required", message: "Check the student's university ID card in person and tick the ID check before completing the handover." });
    expect(db.sql).toHaveLength(0); expect(users.verifyBorrower).not.toHaveBeenCalled(); expect(equipment.getItem).not.toHaveBeenCalled(); nothingSaved();
  });
  it("the ID check never replaces the student's confirmation (both required)", async () => {
    await expect(confirm(body(goodChecklist(), false, versionNow(), true))).rejects.toMatchObject({ code: "student_confirmation_required" });
    await expect(confirm(body(goodChecklist(), "yes", versionNow(), true))).rejects.toMatchObject({ code: "invalid_handover" });
    await expect(confirm(body(goodChecklist(), true, versionNow(), "true"))).rejects.toMatchObject({ code: "invalid_handover" });
    expect(db.sql).toHaveLength(0); nothingSaved();
  });
  it("stores minimal evidence: who checked the ID (the assistant) and when; returned in the outcome and details", async () => {
    const result = await confirm({ ...body(), universityIdNumber: "202012345", idPhoto: "data:image/png;base64,AAAA" });
    expect(db.state.loans[0]).toMatchObject({ university_id_verified_by: assistantId, university_id_verified_at: new Date(result.universityIdVerifiedAt) });
    expect(JSON.stringify(db.state)).not.toMatch(/202012345|base64/);
    expect((await getHandoverDetails(reservationId, labId, assistantId))?.handover).toMatchObject({ universityIdVerifiedAt: result.universityIdVerifiedAt, studentConfirmedAt: result.studentConfirmedAt });
  });
  it("verifies the borrower against the AUTHORITATIVE reservation's borrower_id and lab, at plan time and at final submission", async () => {
    await confirm({ ...body(), borrowerId: "7c9e6679-7425-40de-944b-e07fc1f900aa", labId: 99 });
    expect(users.verifyBorrower.mock.calls).toEqual([[borrowerId, labId], [borrowerId, labId]]);
  });
  it("an ineligible borrower (not a student / other lab / inactive) is refused before checkout", async () => {
    users.verifyBorrower.mockRejectedValueOnce(borrowerIneligible());
    await expect(confirm()).rejects.toMatchObject({ status: 409, code: "borrower_unverified", message: "The borrower must be an active student in this lab, matching the reservation." });
    expect(calls).toHaveLength(0); nothingSaved(); expect(db.state.reservation.handover_operation).toBeNull();
  });
  it("a borrower who becomes ineligible before final submission: guarded undo, no loan", async () => {
    users.verifyBorrower.mockResolvedValueOnce(verified).mockRejectedValueOnce(borrowerIneligible());
    await expect(confirm()).rejects.toMatchObject({ status: 409, code: "borrower_unverified" });
    expect(calls.map(c => c.idempotencyKey.split(":").at(-1))).toEqual(["apply", "undo"]); expect(status).toBe("reserved"); nothingSaved();
  });
  it("recovery reuses the ORIGINAL saved ID check and checklist (no browser data), even when another assistant finishes", async () => {
    const conditions = goodChecklist().map(row => row.kitComponentId === chargerId ? { ...row, conditionStatus: "missing", notes: "Charger not in the case" } : row);
    users.verifyBorrower.mockResolvedValueOnce(verified).mockRejectedValueOnce(borrowerUnavailable());
    await expect(confirm({ ...body(conditions), acknowledgedMissing: [chargerId] })).rejects.toMatchObject({ code: "handover_incomplete" });
    const op = db.state.reservation.handover_operation as { idVerifiedBy: string; result: { universityIdVerifiedAt: string } };
    expect(op.idVerifiedBy).toBe(assistantId);
    const result = await recoverHandover(reservationId, otherAssistant, ports);
    expect(result.universityIdVerifiedAt).toBe(op.result.universityIdVerifiedAt);
    expect(db.state.loans[0]).toMatchObject({ university_id_verified_by: assistantId, university_id_verified_at: new Date(op.result.universityIdVerifiedAt) });
    expect(componentRow(chargerId)).toMatchObject({ condition_status: "missing", notes: "Charger not in the case" });
  });
  it("fails closed on a stored plan without its ID-check evidence or confirmed dates", async () => {
    loss = true; await expect(confirm()).rejects.toThrow();
    // The model replaces rows on rollback: always edit the CURRENT stored plan.
    const op = () => db.state.reservation.handover_operation as Record<string, unknown>;
    const by = op().idVerifiedBy; op().idVerifiedBy = otherAssistant.sub;
    await expect(recover()).rejects.toMatchObject({ code: "handover_state_uncertain" });
    op().idVerifiedBy = by; const window = op().window; delete op().window;
    await expect(recover()).rejects.toMatchObject({ code: "handover_state_uncertain" });
    op().window = window; expect((await recover()).status).toBe("checked_out");
  });
  it.each([
    ["start", () => { db.state.reservation.start_at = new Date(db.state.reservation.start_at.getTime() - 60_000); }],
    ["end (due date)", () => { db.state.reservation.end_at = new Date(db.state.reservation.end_at.getTime() + 86_400_000); }],
  ])("confirmed %s date edited during handover -> 409 at final submission, guarded undo, no loan", async (_name, change) => {
    db.settings.beforeFinalCheck = change;
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "The reservation changed during handover. Reload and check it again." });
    expect(calls.map(c => c.idempotencyKey.split(":").at(-1))).toEqual(["apply", "undo"]); expect(status).toBe("reserved"); nothingSaved();
    // The undone plan belongs to the old dates; a retry plans afresh from the current reservation.
    const result = await confirm();
    expect(result.dueDate).toBe(db.state.reservation.end_at.toISOString()); expect(db.state.loans[0].due_date).toEqual(db.state.reservation.end_at);
  });
  it("uncertain outcome: an unresolved operation blocks a fresh submission and only the same attempt can resume", async () => {
    loss = true; await expect(confirm()).rejects.toMatchObject({ status: 503, code: "handover_state_uncertain" });
    expect((await getHandoverDetails(reservationId, labId, assistantId))?.pending).toMatchObject({ state: "planned" });
    await expect(confirm(body(goodChecklist().map(r => r.kitComponentId === null ? { ...r, notes: "fresh attempt" } : r)))).rejects.toMatchObject({ status: 409, message: "Another handover for this reservation is unfinished. Use Finish interrupted handover first." });
    await expect(confirm(body(), otherAssistant)).rejects.toMatchObject({ status: 409 });
    expect(calls).toHaveLength(1);
    const result = await confirm(); // the SAME information resumes the SAME key
    expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]); expect(result.status).toBe("checked_out"); expect(db.state.loans).toHaveLength(1);
  });
});

describe("PO decision (JS/ZZ): handover fulfils the reservation atomically with the loan and pickup records", () => {
  const reservation = () => db.state.reservation;
  /** Statements of the transaction that inserted the loan (BEGIN..COMMIT). */
  const finalTransaction = () => {
    const insert = db.sql.findIndex(q => q.text.includes("insert into public.loans"));
    const begin = db.sql.slice(0, insert).map(q => q.text).lastIndexOf("BEGIN");
    const commit = db.sql.findIndex((q, i) => i > insert && q.text === "COMMIT");
    return db.sql.slice(begin, commit + 1).map(q => q.text);
  };

  it("success: loan, every pickup record and `fulfilled` are written in ONE transaction, fulfilment last", async () => {
    const result = await confirm();
    expect(reservation().status).toBe("fulfilled");
    expect(reservation().handover_operation).toMatchObject({ state: "completed", result });
    expect(db.state.loans).toHaveLength(1); expect(db.state.records).toHaveLength(6);
    const tx = finalTransaction();
    expect(tx[0]).toBe("BEGIN"); expect(tx.at(-1)).toBe("COMMIT");
    const loan = tx.findIndex(t => t.includes("insert into public.loans"));
    const records = tx.map((t, i) => [t, i] as const).filter(([t]) => t.includes("insert into public.condition_records")).map(([, i]) => i);
    const fulfil = tx.findIndex(t => t.includes("set status = 'fulfilled'"));
    expect(records).toHaveLength(6); expect(loan).toBeLessThan(Math.min(...records)); expect(Math.max(...records)).toBeLessThan(fulfil);
    // The completed operation is stored by the fulfilment statement itself, not separately.
    expect(tx.filter(t => t.startsWith("update public.reservations set handover_operation"))).toHaveLength(0);
    expect(db.sql.find(q => q.text.includes("set status = 'fulfilled'"))?.values.slice(1)).toEqual([reservationId, labId, kitItemId, borrowerId]);
    // The confirmed dates were compared on the row locked FOR UPDATE earlier in this transaction.
    expect(tx.findIndex(t => t.includes("for update"))).toBeLessThan(loan);
  });

  it.each(["error", "zero"] as const)("fulfilment failure (%s): loan and pickup records roll back too; checkout undone; reservation stays confirmed; same retry completes", async failure => {
    db.settings.fulfilFailure = failure;
    await expect(confirm()).rejects.toMatchObject({ status: 503, code: "handover_rolled_back" });
    nothingSaved(); expect(reservation().status).toBe("confirmed"); expect(opState()).toBe("compensated"); expect(status).toBe("reserved");
    expect(calls.map(c => c.idempotencyKey.split(":").at(-1))).toEqual(["apply", "undo"]);
    db.settings.fulfilFailure = "";
    const result = await confirm();
    expect(reservation().status).toBe("fulfilled"); expect(db.state.loans).toEqual([expect.objectContaining({ id: result.loanId })]); expect(db.state.records).toHaveLength(6);
  });

  it.each(["before", "after"] as const)("uncertain final COMMIT (%s): never a fulfilled reservation without its loan and records (or the reverse); retry reconciles", async mode => {
    db.settings.commitFailure = mode;
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" });
    const fulfilled = reservation().status === "fulfilled";
    expect(fulfilled).toBe(mode === "after");
    expect(db.state.loans).toHaveLength(fulfilled ? 1 : 0); expect(db.state.records).toHaveLength(fulfilled ? 6 : 0);
    expect(opState()).toBe(fulfilled ? "completed" : "applied");
    const result = await confirm();
    expect(reservation().status).toBe("fulfilled"); expect(db.state.loans).toEqual([expect.objectContaining({ id: result.loanId })]); expect(db.state.records).toHaveLength(6);
    expect(calls).toHaveLength(1);
  });

  it("recovery of an interrupted ('applied') handover fulfils atomically", async () => {
    users.verifyBorrower.mockResolvedValueOnce(verified).mockRejectedValueOnce(borrowerUnavailable());
    await expect(confirm()).rejects.toMatchObject({ code: "handover_incomplete" });
    expect(reservation().status).toBe("confirmed"); nothingSaved();
    const result = await recover(otherAssistant);
    expect(reservation().status).toBe("fulfilled"); expect(reservation().handover_operation).toMatchObject({ state: "completed", result });
    expect(finalTransaction().some(t => t.includes("set status = 'fulfilled'"))).toBe(true);
  });

  it("recovery whose fulfilment is refused: rolled back and undone by the starter; nothing fulfilled", async () => {
    users.verifyBorrower.mockResolvedValueOnce(verified).mockRejectedValueOnce(borrowerUnavailable());
    await expect(confirm()).rejects.toMatchObject({ code: "handover_incomplete" });
    db.settings.fulfilFailure = "error";
    await expect(recover()).rejects.toMatchObject({ code: "handover_rolled_back" });
    nothingSaved(); expect(reservation().status).toBe("confirmed"); expect(opState()).toBe("compensated"); expect(status).toBe("reserved");
  });

  it("completed retries return the SAME result although the reservation is now fulfilled (submit, recover, after return); nothing is written", async () => {
    const first = await confirm();
    const writes = () => db.sql.filter(q => /^(insert|update)/.test(q.text)).length;
    const before = writes();
    expect(await confirm()).toEqual(first);
    expect(await recover(otherAssistant)).toEqual(first);
    db.state.loans[0].returned_at = new Date(); // Return completed later; the reservation stays fulfilled.
    expect(await confirm()).toEqual(first);
    expect(writes()).toBe(before); expect(calls).toHaveLength(1); expect(reservation().status).toBe("fulfilled");
    // Different information after completion is still refused.
    await expect(confirm(body(goodChecklist().map((r, i) => i ? r : { ...r, notes: "changed" })))).rejects.toMatchObject({ status: 409, message: "This reservation has already been handed over." });
  });

  it("a completed operation on a reservation that is NOT fulfilled is an inconsistency, never a success", async () => {
    await confirm();
    reservation().status = "confirmed";
    await expect(confirm()).rejects.toMatchObject({ code: "handover_state_uncertain" });
    await expect(recover()).rejects.toMatchObject({ code: "handover_state_uncertain" });
  });

  it("a fulfilled reservation can never start a new handover", async () => {
    reservation().status = "fulfilled";
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "Only confirmed reservations can be handed over." });
    expect(calls).toHaveLength(0); nothingSaved();
  });

  it("without the reservation status permission (LJ's S2-01 grant): 503 before any plan or Equipment change", async () => {
    db.settings.noFulfillmentGrant = true;
    await expect(confirm()).rejects.toMatchObject({ status: 503, code: "reservation_fulfillment_unavailable" });
    expect(calls).toHaveLength(0); expect(equipment.getItem).not.toHaveBeenCalled(); expect(users.verifyBorrower).not.toHaveBeenCalled();
    expect(reservation().handover_operation).toBeNull(); expect(reservation().status).toBe("confirmed"); nothingSaved();
  });

  it("re-applying after a confirmed undo re-checks the permission too", async () => {
    db.settings.recordFailure = true;
    await expect(confirm()).rejects.toMatchObject({ code: "handover_rolled_back" });
    db.settings.recordFailure = false; db.settings.noFulfillmentGrant = true;
    await expect(confirm()).rejects.toMatchObject({ code: "reservation_fulfillment_unavailable" });
    expect(calls).toHaveLength(2); expect(opState()).toBe("compensated"); expect(status).toBe("reserved");
  });
});

describe("PO decisions: pickup eligibility is start_at <= now < end_at; multiple eligible reservations block", () => {
  afterEach(() => { vi.useRealTimers(); });
  const at = (iso: string) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(iso)); };

  it("eligible exactly at start_at", async () => {
    at("2026-11-20T09:00:00.000Z");
    db.state.reservation.start_at = new Date("2026-11-20T09:00:00.000Z"); db.state.reservation.end_at = new Date("2026-11-21T09:00:00.000Z");
    expect((await confirm()).dueDate).toBe("2026-11-21T09:00:00.000Z");
    expect(db.state.reservation.status).toBe("fulfilled");
  });
  it("not eligible exactly at end_at, nor 1 ms before start_at", async () => {
    db.state.reservation.start_at = new Date("2026-11-20T09:00:00.000Z"); db.state.reservation.end_at = new Date("2026-11-21T09:00:00.000Z");
    at("2026-11-21T09:00:00.000Z");
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "The reservation pickup window has ended." });
    at("2026-11-20T08:59:59.999Z");
    await expect(confirm()).rejects.toMatchObject({ status: 409, message: "The reservation pickup window has not started." });
    expect(calls).toHaveLength(0); nothingSaved(); expect(db.state.reservation.status).toBe("confirmed");
  });
  it("another reservation that ENDS exactly now is not eligible, so exactly one remains and is selected automatically", async () => {
    at("2026-11-20T12:00:00.000Z");
    db.state.reservation.start_at = new Date("2026-11-20T10:00:00.000Z"); db.state.reservation.end_at = new Date("2026-11-21T10:00:00.000Z");
    db.state.otherReservations.push({ id: "7c9e6679-7425-40de-944b-e07fc1f900b9", item_id: kitItemId, status: "confirmed", start_at: new Date("2026-11-20T08:00:00.000Z"), end_at: new Date("2026-11-20T12:00:00.000Z") });
    expect((await confirm()).status).toBe("checked_out");
    expect(db.state.reservation.status).toBe("fulfilled");
  });
  it("two eligible reservations: blocked with the conflict message; a client cannot choose one", async () => {
    db.state.otherReservations.push({ id: "7c9e6679-7425-40de-944b-e07fc1f900b8", item_id: kitItemId, status: "confirmed", start_at: new Date(Date.now() - 60_000), end_at: new Date(Date.now() + 60_000) });
    await expect(confirm({ ...body(), reservationChoice: "7c9e6679-7425-40de-944b-e07fc1f900b8" })).rejects.toMatchObject({ status: 409, message: "More than one reservation is eligible for this equipment right now. Ask staff to resolve the overlap." });
    expect(calls).toHaveLength(0); nothingSaved(); expect(db.state.reservation.status).toBe("confirmed");
  });
});
