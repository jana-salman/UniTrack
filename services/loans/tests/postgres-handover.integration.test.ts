// C430PRJCT-40 / S2-09 against DISPOSABLE PostgreSQL only (database/local-test/run.ps1).
// Loans runs as the restricted unitrack_loans_service group and Equipment as
// unitrack_equipment_service, after migrations 003-006 and the S2-09 migration.
// All rows below are synthetic and created by this file.
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserIdentity } from "@unitrack/contracts";
import { EquipmentStatusConflictError, IdempotencyKeyConflictError, updateEquipmentStatus } from "../../equipment/lib/equipment-status-transaction";
import type { EquipmentStatus, ReturnStatusChange } from "../lib/returns/equipment-port";
import type { HandoverEquipmentPort } from "../lib/handover/equipment-port";

vi.mock("server-only", () => ({}));
const database = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("../lib/db", () => ({
  getDatabasePool: () => {
    if (!database.pool) throw new Error("Local integration pool is not ready");
    return database.pool;
  },
}));

import { checklistVersionOf, confirmHandover, recoverHandover } from "../lib/handover/service";
import { borrowerUnavailable, borrowerUnverified, type BorrowerPort } from "../lib/users-http";
import { getHandoverDetails } from "../lib/handover/queries";
import { LoansError } from "../lib/errors";
import { confirmReturn } from "../lib/returns/service";

const expectedDatabaseUrl = "postgresql://unitrack_local_test:local_test_only@127.0.0.1:55432/unitrack_test";
const configuredDatabaseUrl = process.env.UNITRACK_TEST_DATABASE_URL;
const localDescribe = configuredDatabaseUrl ? describe.sequential : describe.skip;

const id = (suffix: string) => "00000000-0000-4000-8000-" + suffix.padStart(12, "0");
const labId = 7201;
const assistantId = id("901"), borrowerId = id("902"), inactiveBorrowerId = id("903"), otherAssistantId = id("904");
const items = { tc31: id("911"), tc34: id("912"), tc35: id("913"), tc37: id("914"), outage: id("915"), laterChange: id("916"), laterAba: id("918"), overlap: id("917"), finalCancel: id("931"), finalOverlap: id("932"), inactive: id("933"), interrupted: id("934"), componentChange: id("935"), availableRace: id("936") };
const reservations = { tc31: id("921"), tc34: id("922"), tc35: id("923"), tc37: id("924"), outage: id("925"), laterChange: id("926"), laterAba: id("929"), overlap: id("927"), finalCancel: id("941"), finalOverlap: id("942"), inactive: id("943"), interrupted: id("944"), componentChange: id("945"), availableRace: id("946") };
const overlapSecondReservation = id("928");
const names = ["Charger", "Cable", "Battery", "Case", "Tripod"];
const componentIds = (item: string) => names.map((_, index) => id(item.slice(-3) + "c" + index));
const actor: UserIdentity = { kind: "user", sub: assistantId, role: "lab_assistant", lab_id: labId, rid: "local-handover-test" };
const otherAssistant: UserIdentity = { ...actor, sub: otherAssistantId, rid: "local-handover-other" };

let admin: Pool, loansPool: Pool, equipmentPool: Pool, usersPool: Pool;
let usersDown = false;
let failNextCheckout = false;
// Hooks inject real database events between the Saga's steps.
const hooks: { beforeApply?: () => Promise<void>; afterApply?: () => Promise<void>; beforeUndo?: () => Promise<void> } = {};
function restricted(role: string): Pool {
  const pool = new Pool({ connectionString: configuredDatabaseUrl, max: 4 });
  pool.on("connect", client => { void client.query("SET ROLE " + role); });
  return pool;
}

// Equipment port backed by Equipment's real SQL under its restricted role.
const equipment: HandoverEquipmentPort & { getComponents(): Promise<never[]> } = {
  async getItem(itemId, requestedLab) {
    const row = (await equipmentPool.query<{ id: string; lab_id: number; status: EquipmentStatus }>(
      "SELECT id, lab_id, status FROM public.equipment_items WHERE id = $1 AND lab_id = $2", [itemId, requestedLab])).rows[0];
    return row ? { id: row.id, name: "", labId: row.lab_id, status: row.status } : null;
  },
  async getKitComponents(itemId, requestedLab) {
    const rows = (await equipmentPool.query<{ id: string; component_name: string; is_active: boolean; is_required: boolean }>(
      "SELECT c.id, c.component_name, c.quantity_required, c.tracked_item_id, c.is_required, c.is_active FROM public.kit_components c JOIN public.kits k ON k.item_id = c.kit_item_id AND k.lab_id = c.lab_id WHERE c.kit_item_id = $1 AND c.lab_id = $2 ORDER BY c.component_name, c.id",
      [itemId, requestedLab])).rows;
    return rows.map(row => ({ id: row.id, name: row.component_name, isActive: row.is_active, isRequired: row.is_required }));
  },
  async changeStatus(input: ReturnStatusChange) {
    if (failNextCheckout) { failNextCheckout = false; throw new Error("Dummy Equipment outage before any change"); }
    const undo = input.idempotencyKey.endsWith(":undo");
    if (undo && hooks.beforeUndo) { const hook = hooks.beforeUndo; delete hooks.beforeUndo; await hook(); }
    if (!undo && hooks.beforeApply) { const hook = hooks.beforeApply; delete hooks.beforeApply; await hook(); }
    const client = await equipmentPool.connect();
    try {
      const result = await updateEquipmentStatus(client, input.itemId, input.status, input.changedBy, input.labId, input.reason, {
        expectedStatus: input.expectedStatus, expectedOperationKey: input.expectedOperationKey, idempotencyKey: input.idempotencyKey, trackOperation: true,
      });
      if (!undo && hooks.afterApply) { const hook = hooks.afterApply; delete hooks.afterApply; await hook(); }
      return { changed: result.changed };
    } catch (error) {
      // Same classification as the HTTP adapter: Equipment's 409 is a confirmed rejection.
      if (error instanceof EquipmentStatusConflictError || error instanceof IdempotencyKeyConflictError) throw new LoansError(409, "equipment_rejected", "Equipment rejected the return operation. Verify its status before retrying.");
      throw error;
    } finally { client.release(); }
  },
  async getComponents() { return []; },
};

// Users port backed by Users' real SQL under its restricted role (Loans itself
// never reads profiles). Mirrors the Users endpoint: same lab and active.
const users: BorrowerPort = {
  async verifyBorrower(borrower) {
    if (usersDown) throw borrowerUnavailable();
    const row = (await usersPool.query<{ id: string; full_name: string; role: string; lab_id: number; is_active: boolean }>(
      "SELECT id, full_name, role, lab_id, is_active FROM public.profiles WHERE id = $1", [borrower])).rows[0];
    if (!row || row.lab_id !== labId || !row.is_active) throw borrowerUnverified();
    return { id: row.id, fullName: row.full_name, role: row.role };
  },
};
const ports = { equipment, users };
/** Main-item row first (explicit condition), then one row per component. */
const kitChecklist = (item: string, change: (row: Record<string, unknown>, index: number) => Record<string, unknown> = row => row) =>
  [{ kitComponentId: null, checked: true, conditionStatus: "good", notes: "" },
    ...componentIds(item).map((kitComponentId, index) => change({ kitComponentId, checked: true, conditionStatus: "good", notes: "" }, index))];
/** Submit like the page: with the checklist version computed from Equipment's current data. */
async function submit(reservation: string, input: Record<string, unknown>, as: UserIdentity = actor) {
  const item = (await admin.query<{ item_id: string }>("select item_id from public.reservations where id = $1", [reservation])).rows[0].item_id;
  const checklistVersion = checklistVersionOf(item, await equipment.getKitComponents(item, labId));
  return confirmHandover(reservation, { checklistVersion, ...input }, as, ports);
}
const itemStatus = async (item: string) => (await admin.query<{ status: string }>("select status from public.equipment_items where id = $1", [item])).rows[0].status;
const loansFor = async (reservation: string) => (await admin.query("select * from public.loans where reservation_id = $1", [reservation])).rows;
const pickupFor = async (loan: string) => (await admin.query("select * from public.condition_records where loan_id = $1 and phase = 'pickup' order by kit_component_id nulls first", [loan])).rows;

localDescribe("C430PRJCT-40 handover on disposable PostgreSQL", () => {
  beforeAll(async () => {
    if (configuredDatabaseUrl !== expectedDatabaseUrl) throw new Error("Refusing database integration test: use only database/local-test/run.ps1");
    admin = new Pool({ connectionString: configuredDatabaseUrl, max: 2 });
    loansPool = restricted("unitrack_loans_service");
    equipmentPool = restricted("unitrack_equipment_service");
    usersPool = restricted("unitrack_users_service");
    database.pool = loansPool;
    // Synthetic fixtures owned by this test file (fresh tmpfs container each run).
    await admin.query("insert into auth.users (id) values ($1), ($2), ($3), ($4) on conflict do nothing", [assistantId, borrowerId, inactiveBorrowerId, otherAssistantId]);
    await admin.query("insert into public.labs (id, code, name) overriding system value values ($1, 'S2-09-TEST', 'Disposable Handover Lab') on conflict do nothing", [labId]);
    await admin.query("insert into public.equipment_categories (id, name, description) overriding system value values (7201, 'S2-09 Kits', 'Synthetic') on conflict do nothing");
    await admin.query(`insert into public.profiles (id, full_name, university_email, role, lab_id) values
      ($1, 'Handover Assistant', 's209-assistant@lau.edu', 'lab_assistant', $3), ($2, 'Handover Student', 's209-student@lau.edu', 'student', $3),
      ($4, 'Inactive Student', 's209-inactive@lau.edu', 'student', $3), ($5, 'Second Assistant', 's209-assistant2@lau.edu', 'lab_assistant', $3) on conflict do nothing`, [assistantId, borrowerId, labId, inactiveBorrowerId, otherAssistantId]);
    await admin.query("update public.profiles set is_active = false where id = $1", [inactiveBorrowerId]);
    for (const [key, item] of Object.entries(items)) {
      const kit = key !== "tc35";
      const startStatus = key === "tc35" || key === "availableRace" ? "available" : "reserved";
      await admin.query("insert into public.equipment_items (id, asset_code, name, category_id, lab_id, status, condition) values ($1, $2, $3, 7201, $4, $5, 'good')",
        [item, "S209-" + key.toUpperCase(), kit ? "Five-component kit " + key : "Oscilloscope", labId, startStatus]);
      if (kit) {
        await admin.query("insert into public.kits (item_id, lab_id) values ($1, $2)", [item, labId]);
        for (const [index, componentName] of names.entries()) {
          await admin.query("insert into public.kit_components (id, kit_item_id, lab_id, component_name) values ($1, $2, $3, $4)", [componentIds(item)[index], item, labId, componentName]);
        }
      }
      await admin.query("insert into public.reservations (id, item_id, borrower_id, lab_id, start_at, end_at, status) values ($1, $2, $3, $4, now() - interval '1 hour', now() + interval '7 days', 'confirmed')",
        [reservations[key as keyof typeof reservations], item, key === "inactive" ? inactiveBorrowerId : borrowerId, labId]);
    }
    // Overlapping confirmed reservation for the same item (overlap rules are the reservations card's job).
    await admin.query("insert into public.reservations (id, item_id, borrower_id, lab_id, start_at, end_at, status) values ($1, $2, $3, $4, now() - interval '1 hour', now() + interval '7 days', 'confirmed')",
      [overlapSecondReservation, items.overlap, borrowerId, labId]);
    // An inactive component must not be required or accepted.
    await admin.query("insert into public.kit_components (id, kit_item_id, lab_id, component_name, is_active) values ($1, $2, $3, 'Retired lens cap', false)", [id("911c9"), items.tc31, labId]);
  });

  afterAll(async () => {
    database.pool = null;
    await Promise.all([admin?.end(), loansPool?.end(), equipmentPool?.end(), usersPool?.end()]);
  });

  it("TC-3.1: five Good components + confirmation -> one loan, five pickup records, Borrowed; replay writes nothing", async () => {
    const input = { studentConfirmed: true, conditions: kitChecklist(items.tc31) };
    const result = await submit(reservations.tc31, input);
    expect(result).toMatchObject({ reservationId: reservations.tc31, itemId: items.tc31, borrowerId, status: "checked_out" });
    expect(await itemStatus(items.tc31)).toBe("checked_out");
    const [loan] = await loansFor(reservations.tc31);
    expect(loan).toMatchObject({ id: result.loanId, borrower_id: borrowerId, item_id: items.tc31, lab_id: labId, returned_at: null, return_operation: null });
    expect(loan.student_confirmed_at).toBeInstanceOf(Date);
    expect(loan.due_date.toISOString()).toBe(result.dueDate);
    const pickup = await pickupFor(result.loanId);
    expect(pickup).toHaveLength(6);
    expect(pickup.map(row => row.kit_component_id ?? "main").sort()).toEqual(["main", ...componentIds(items.tc31)].sort());
    expect(pickup.every(row => row.phase === "pickup" && row.condition_status === "good" && row.recorded_by === assistantId)).toBe(true);
    const history = await admin.query("select old_status, new_status, request_key from public.equipment_status_history where item_id = $1", [items.tc31]);
    expect(history.rows).toEqual([{ old_status: "reserved", new_status: "checked_out", request_key: expect.stringMatching(/^handover:.+:0:apply$/) }]);

    expect(await submit(reservations.tc31, input)).toEqual(result);
    expect(await loansFor(reservations.tc31)).toHaveLength(1);
    expect(await pickupFor(result.loanId)).toHaveLength(6);
    expect((await getHandoverDetails(reservations.tc31, labId, assistantId))?.handover?.pickupConditions).toHaveLength(6);

    // Existing Return accepts this pickup shape (main row + every pickup component).
    const returned = await confirmReturn(result.loanId, { conditions: [{ kitComponentId: null, conditionStatus: "good" }, ...componentIds(items.tc31).map(kitComponentId => ({ kitComponentId, conditionStatus: "good" }))] }, actor, equipment);
    expect(returned).toMatchObject({ status: "available", isLate: false });
  });

  it("TC-3.4: a missing charger is stored as missing with its note", async () => {
    const result = await submit(reservations.tc34, { studentConfirmed: true, acknowledgedMissing: [componentIds(items.tc34)[0]], conditions: kitChecklist(items.tc34, (row, i) => i === 0 ? { ...row, conditionStatus: "missing", notes: "Charger not in the case" } : row) });
    const charger = (await pickupFor(result.loanId)).find(row => row.kit_component_id === componentIds(items.tc34)[0]);
    expect(charger).toMatchObject({ condition_status: "missing", notes: "Charger not in the case" });
    expect(await itemStatus(items.tc34)).toBe("checked_out");
  });

  it("TC-3.5: non-kit existing damage is saved with its note (no photo); Return treats it as pre-existing", async () => {
    const result = await submit(reservations.tc35, { studentConfirmed: true, conditions: [{ kitComponentId: null, checked: true, conditionStatus: "damaged", notes: "Dent on the side panel" }] });
    expect(await pickupFor(result.loanId)).toEqual([expect.objectContaining({ kit_component_id: null, condition_status: "damaged", notes: "Dent on the side panel" })]);
    const returned = await confirmReturn(result.loanId, { conditions: [{ kitComponentId: null, conditionStatus: "damaged" }] }, actor, equipment);
    expect(returned.status).toBe("available");
  });

  it("TC-3.7: without confirmation the item stays Reserved and no loan exists; then concurrent confirmations create exactly one", async () => {
    await expect(submit(reservations.tc37, { studentConfirmed: false, conditions: kitChecklist(items.tc37) })).rejects.toMatchObject({ code: "student_confirmation_required" });
    expect(await itemStatus(items.tc37)).toBe("reserved");
    expect(await loansFor(reservations.tc37)).toHaveLength(0);
    expect((await admin.query("select handover_operation from public.reservations where id = $1", [reservations.tc37])).rows[0].handover_operation).toBeNull();

    const input = { studentConfirmed: true, conditions: kitChecklist(items.tc37) };
    const results = await Promise.allSettled([1, 2, 3].map(() => submit(reservations.tc37, input)));
    expect(results.filter(r => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(await loansFor(reservations.tc37)).toHaveLength(1);
    const keyed = await admin.query("select count(*)::int as count from public.equipment_status_history where item_id = $1 and new_status = 'checked_out'", [items.tc37]);
    expect(keyed.rows[0].count).toBe(1);
  });

  it("Equipment outage leaves a durable plan and no loan; the same retry completes", async () => {
    failNextCheckout = true;
    const input = { studentConfirmed: true, conditions: kitChecklist(items.outage) };
    await expect(submit(reservations.outage, input)).rejects.toMatchObject({ code: "handover_state_uncertain" });
    expect(await loansFor(reservations.outage)).toHaveLength(0);
    expect(await itemStatus(items.outage)).toBe("reserved");
    expect((await admin.query("select handover_operation ->> 'state' as state from public.reservations where id = $1", [reservations.outage])).rows[0].state).toBe("planned");
    await submit(reservations.outage, input);
    expect(await loansFor(reservations.outage)).toHaveLength(1);
  });

  // Real independent change through Equipment's own transaction while our local
  // save is failing (a manager moving the item to repair, possibly and back).
  async function independentChange(item: string, statuses: EquipmentStatus[]) {
    for (const [index, status] of statuses.entries()) {
      const client = await equipmentPool.connect();
      try { await updateEquipmentStatus(client, item, status, assistantId, labId, "Independent legitimate change", { expectedStatus: [index === 0 ? "checked_out" : statuses[index - 1]] }); }
      finally { client.release(); }
    }
  }
  it.each([
    ["a later change to Under Repair", "laterChange", ["under_maintenance"], "under_maintenance"],
    ["a later change that returns to checked_out (ABA)", "laterAba", ["under_maintenance", "checked_out"], "checked_out"],
  ] as const)("restoring Reserved cannot overwrite %s", async (_name, key, statuses, finalStatus) => {
    const item = items[key], reservation = reservations[key];
    // Make the local loan transaction fail AFTER checkout: another active loan
    // for the item violates loans_one_active_per_item (real unique index).
    hooks.afterApply = async () => { await admin.query("insert into public.loans (item_id, borrower_id, lab_id, due_date) values ($1, $2, $3, now() + interval '1 day')", [item, borrowerId, labId]); };
    hooks.beforeUndo = () => independentChange(item, [...statuses]);
    await expect(submit(reservation, { studentConfirmed: true, conditions: kitChecklist(item) })).rejects.toMatchObject({ code: "handover_state_uncertain" });
    expect(await itemStatus(item)).toBe(finalStatus);
    expect(await loansFor(reservation)).toHaveLength(0);
    const history = await admin.query<{ new_status: string; request_key: string | null }>("select new_status, request_key from public.equipment_status_history where item_id = $1 order by id", [item]);
    expect(history.rows.map(row => row.new_status)).toEqual(["checked_out", ...statuses]);
    expect(history.rows.some(row => row.request_key?.endsWith(":undo"))).toBe(false);
    expect((await admin.query("select handover_operation ->> 'state' as state from public.reservations where id = $1", [reservation])).rows[0].state).toBe("compensating");
    // A retry stays blocked for staff reconciliation and still changes nothing.
    await expect(submit(reservation, { studentConfirmed: true, conditions: kitChecklist(item) })).rejects.toMatchObject({ code: "handover_state_uncertain" });
    expect(await itemStatus(item)).toBe(finalStatus);
  });

  it("SC rule: two simultaneously eligible reservations for one item block BOTH handovers, even submitted concurrently", async () => {
    const attempts = [reservations.overlap, overlapSecondReservation].map(reservation =>
      submit(reservation, { studentConfirmed: true, conditions: kitChecklist(items.overlap) }));
    const results = await Promise.allSettled(attempts);
    expect(results.every(r => r.status === "rejected" && (r.reason as { status: number }).status === 409)).toBe(true);
    expect(await admin.query("select 1 from public.loans where item_id = $1", [items.overlap]).then(r => r.rows)).toHaveLength(0);
    expect(await itemStatus(items.overlap)).toBe("reserved");
    expect((await admin.query("select count(*)::int as n from public.equipment_status_history where item_id = $1", [items.overlap])).rows[0].n).toBe(0);
    // Once the overlap is resolved (the other reservation is cancelled), exactly one eligible reservation permits handover.
    await admin.query("update public.reservations set status = 'cancelled' where id = $1", [overlapSecondReservation]);
    const result = await submit(reservations.overlap, { studentConfirmed: true, conditions: kitChecklist(items.overlap) });
    expect(result.status).toBe("checked_out"); expect(await loansFor(reservations.overlap)).toHaveLength(1);
  });

  it.each([
    ["reservation cancelled by another connection", "finalCancel", "Only confirmed reservations can be handed over."],
    ["a second eligible reservation committed", "finalOverlap", "More than one reservation is eligible for this equipment right now. Ask staff to resolve the overlap."],
  ] as const)("final submission re-verifies on committed state: %s after checkout -> 409, Reserved restored, no loan", async (_name, key, message) => {
    const item = items[key], reservation = reservations[key];
    hooks.afterApply = async () => {
      if (key === "finalCancel") await admin.query("update public.reservations set status = 'cancelled' where id = $1", [reservation]);
      else await admin.query("insert into public.reservations (id, item_id, borrower_id, lab_id, start_at, end_at, status) values ($1, $2, $3, $4, now() - interval '10 minutes', now() + interval '1 day', 'confirmed')", [id("949"), item, borrowerId, labId]);
    };
    await expect(submit(reservation, { studentConfirmed: true, conditions: kitChecklist(item) })).rejects.toMatchObject({ status: 409, code: "handover_conflict", message });
    expect(await itemStatus(item)).toBe("reserved");
    expect(await loansFor(reservation)).toHaveLength(0);
    expect((await admin.query("select count(*)::int as n from public.condition_records where item_id = $1", [item])).rows[0].n).toBe(0);
    const history = await admin.query<{ new_status: string; request_key: string }>("select new_status, request_key from public.equipment_status_history where item_id = $1 order by id", [item]);
    expect(history.rows.map(r => r.new_status)).toEqual(["checked_out", "reserved"]);
    expect(history.rows[1].request_key).toMatch(/:0:undo$/);
    expect((await admin.query("select handover_operation ->> 'state' as state from public.reservations where id = $1", [reservation])).rows[0].state).toBe("compensated");
  });

  it("identity: an inactive borrower profile (via the restricted Users role) blocks handover before any Equipment change", async () => {
    await expect(submit(reservations.inactive, { studentConfirmed: true, conditions: kitChecklist(items.inactive) })).rejects.toMatchObject({ status: 409, code: "borrower_unverified" });
    expect(await itemStatus(items.inactive)).toBe("reserved");
    expect(await loansFor(reservations.inactive)).toHaveLength(0);
    expect((await admin.query("select handover_operation from public.reservations where id = $1", [reservations.inactive])).rows[0].handover_operation).toBeNull();
    expect((await admin.query("select count(*)::int as n from public.equipment_status_history where item_id = $1", [items.inactive])).rows[0].n).toBe(0);
  });

  it("interrupted after checkout: durable 'applied' plan, no false success; another assistant finishes it without the browser", async () => {
    hooks.afterApply = async () => { usersDown = true; };
    const conditions = kitChecklist(items.interrupted, (row, i) => i === 0 ? { ...row, conditionStatus: "missing", notes: "Charger not in the case" } : row);
    await expect(submit(reservations.interrupted, { studentConfirmed: true, acknowledgedMissing: [componentIds(items.interrupted)[0]], conditions })).rejects.toMatchObject({ status: 503, code: "handover_incomplete" });
    usersDown = false;
    expect(await itemStatus(items.interrupted)).toBe("checked_out");
    expect(await loansFor(reservations.interrupted)).toHaveLength(0);
    const plan = (await admin.query("select handover_operation as op from public.reservations where id = $1", [reservations.interrupted])).rows[0].op;
    expect(plan).toMatchObject({ state: "applied", actor: assistantId });
    expect(plan.conditions).toHaveLength(6);
    const result = await recoverHandover(reservations.interrupted, otherAssistant, ports);
    expect(result.status).toBe("checked_out");
    const pickup = await pickupFor(result.loanId);
    expect(pickup).toHaveLength(6);
    expect(pickup.every(row => row.recorded_by === assistantId)).toBe(true);
    expect(pickup.find(row => row.kit_component_id === componentIds(items.interrupted)[0])).toMatchObject({ condition_status: "missing", notes: "Charger not in the case" });
    expect((await admin.query("select count(*)::int as n from public.equipment_status_history where item_id = $1", [items.interrupted])).rows[0].n).toBe(1);
  });

  it("component membership changed in Equipment after checkout: no stale records, checkout undone", async () => {
    hooks.afterApply = async () => {
      await admin.query("insert into public.kit_components (id, kit_item_id, lab_id, component_name) values ($1, $2, $3, 'Spare battery')", [id("935c8"), items.componentChange, labId]);
    };
    await expect(submit(reservations.componentChange, { studentConfirmed: true, conditions: kitChecklist(items.componentChange) }))
      .rejects.toMatchObject({ status: 409, message: "The equipment's component list changed. Reload the checklist and check it again." });
    expect(await itemStatus(items.componentChange)).toBe("reserved");
    expect(await loansFor(reservations.componentChange)).toHaveLength(0);
    expect((await admin.query("select count(*)::int as n from public.condition_records where item_id = $1", [items.componentChange])).rows[0].n).toBe(0);
    const history = await admin.query<{ new_status: string }>("select new_status from public.equipment_status_history where item_id = $1 order by id", [items.componentChange]);
    expect(history.rows.map(row => row.new_status)).toEqual(["checked_out", "reserved"]);
  });

  it("A2: an Available item changed by another writer after validation is rejected by Equipment; no loan, no duplicate checkout", async () => {
    hooks.beforeApply = async () => {
      const client = await equipmentPool.connect();
      try { await updateEquipmentStatus(client, items.availableRace, "under_maintenance", otherAssistantId, labId, "Independent change before checkout", { expectedStatus: ["available"] }); }
      finally { client.release(); }
    };
    await expect(submit(reservations.availableRace, { studentConfirmed: true, conditions: kitChecklist(items.availableRace) })).rejects.toMatchObject({ status: 409, code: "equipment_rejected" });
    expect(await itemStatus(items.availableRace)).toBe("under_maintenance");
    expect(await loansFor(reservations.availableRace)).toHaveLength(0);
    const history = await admin.query<{ new_status: string }>("select new_status from public.equipment_status_history where item_id = $1 order by id", [items.availableRace]);
    expect(history.rows.map(row => row.new_status)).toEqual(["under_maintenance"]);
  });

  it("the student confirmation is immutable for the restricted Loans role; Return-style updates still work", async () => {
    const [loan] = await loansFor(reservations.tc34);
    await expect(loansPool.query("update public.loans set student_confirmed_at = null where id = $1", [loan.id])).rejects.toMatchObject({ code: "P0001" });
    await expect(loansPool.query("update public.loans set return_operation = return_operation where id = $1", [loan.id])).resolves.toBeDefined();
  });

  it("the restricted Loans role cannot bypass custody protections", async () => {
    const [loan] = await loansFor(reservations.tc34);
    await expect(loansPool.query("update public.condition_records set notes = 'edited' where loan_id = $1", [loan.id])).rejects.toMatchObject({ code: "42501" });
    await expect(loansPool.query("delete from public.condition_records where loan_id = $1", [loan.id])).rejects.toMatchObject({ code: "42501" });
    await expect(loansPool.query("delete from public.loans where id = $1", [loan.id])).rejects.toMatchObject({ code: "42501" });
    await expect(loansPool.query("update public.reservations set status = 'cancelled' where id = $1", [reservations.tc34])).rejects.toMatchObject({ code: "42501" });
    await expect(loansPool.query("insert into public.loans (item_id, borrower_id, lab_id, due_date) values ($1, $2, $3, now() + interval '1 day')", [items.tc35, borrowerId, labId])).rejects.toMatchObject({ code: "42501" });
    await expect(equipmentPool.query("select student_confirmed_at from public.loans")).rejects.toMatchObject({ code: "42501" });
  });
});
