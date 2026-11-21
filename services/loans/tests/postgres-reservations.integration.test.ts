import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserIdentity } from "@unitrack/contracts";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("../lib/db", () => ({ getDatabasePool: () => {
  if (!state.pool) throw new Error("Disposable reservation integration pool is not ready");
  return state.pool;
} }));
import { createReservation } from "../lib/reservations/create";

const expectedUrl = "postgresql://unitrack_local_test:local_test_only@127.0.0.1:55433/unitrack_test";
const configuredUrl = process.env.UNITRACK_TEST_DATABASE_URL;
const localDescribe = configuredUrl ? describe.sequential : describe.skip;
const borrower = "00000000-0000-4000-8000-000000000002";
const kitId = "51000000-0000-4000-8000-000000000101";
// Component sorts before the kit. This catches accidental parent-first lock order.
const componentId = "41000000-0000-4000-8000-000000000102";
const secondComponentId = "51000000-0000-4000-8000-000000000103";
const otherItemId = "51000000-0000-4000-8000-000000000104";
const actor: UserIdentity = { kind: "user", sub: borrower, role: "student", lab_id: 7001, rid: "postgres-reservation-test" };
const now = new Date();
let pool: Pool;

function atDay(daysFromNow: number) {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString();
}

function equipment(kitComponents: { tracked_item_id: string; status: string; is_restricted: boolean }[] = []) {
  return {
    async getReservationItem(id: string) {
      if (![kitId, componentId, secondComponentId, otherItemId].includes(id)) return null;
      return { id, lab_id: 7001, status: "available", is_restricted: false };
    },
    async getReservationComponents(id: string) { return id === kitId ? kitComponents : []; },
  };
}

async function reserve(itemId: string, startAt: string, endAt: string, kitComponents: { tracked_item_id: string; status: string; is_restricted: boolean }[] = []) {
  return createReservation({ itemId, startAt, endAt }, actor, equipment(kitComponents), now);
}

async function clearTestReservations() {
  await pool.query("delete from public.reservation_resources where resource_item_id = any($1::uuid[])", [[kitId, componentId, secondComponentId, otherItemId]]);
  await pool.query("delete from public.reservations where item_id = any($1::uuid[])", [[kitId, componentId, secondComponentId, otherItemId]]);
}

localDescribe("reservation exclusion and kit-resource integration on disposable PostgreSQL", () => {
  beforeAll(async () => {
    if (configuredUrl !== expectedUrl) throw new Error("Refusing PostgreSQL test: use only database/local-test/run.ps1.");
    pool = new Pool({ connectionString: configuredUrl, max: 8 });
    state.pool = pool;
    await pool.query("select 1");
    await pool.query(
      `insert into public.equipment_items (id, asset_code, name, category_id, lab_id, status, condition)
       values ($1, 'LOCAL-KIT-RES', 'Reservation Test Kit', 7101, 7001, 'available', 'good'),
              ($2, 'LOCAL-KIT-COMP', 'Reservation Test Component', 7101, 7001, 'available', 'good'),
              ($3, 'LOCAL-KIT-COMP2', 'Reservation Test Component Two', 7101, 7001, 'available', 'good'),
              ($4, 'LOCAL-KIT-OTHER', 'Reservation Test Other Item', 7101, 7001, 'available', 'good')`,
      [kitId, componentId, secondComponentId, otherItemId],
    );
    await pool.query("insert into public.kits (item_id, lab_id) values ($1, 7001)", [kitId]);
    await pool.query(
      `insert into public.kit_components (kit_item_id, lab_id, component_name, tracked_item_id)
       values ($1, 7001, 'Reservation Test Component', $2)`, [kitId, componentId]);
  });

  afterEach(async () => { await clearTestReservations(); });

  afterAll(async () => {
    if (pool) {
      await clearTestReservations();
      await pool.query("delete from public.kit_components where kit_item_id = $1", [kitId]);
      await pool.query("delete from public.kits where item_id = $1", [kitId]);
      await pool.query("delete from public.equipment_items where id = any($1::uuid[])", [[kitId, componentId, secondComponentId, otherItemId]]);
      state.pool = null;
      await pool.end();
    }
  });

  it("rejects overlapping confirmed reservations, allows adjacent and different-item bookings", async () => {
    await reserve(componentId, atDay(2), atDay(4));
    await expect(reserve(componentId, atDay(3), atDay(5)))
      .rejects.toMatchObject({ status: 409, code: "reservation_conflict" });
    await expect(reserve(componentId, atDay(4), atDay(5)))
      .resolves.toMatchObject({ status: "confirmed" });
    await expect(reserve(otherItemId, atDay(3), atDay(5)))
      .resolves.toMatchObject({ status: "confirmed" });
  });

  it("allows pending and cancelled rows to overlap confirmed reservations", async () => {
    await pool.query(
      `insert into public.reservations (id, item_id, borrower_id, lab_id, start_at, end_at, status)
       values ('52000000-0000-4000-8000-000000000101', $1, $2, 7001, '${atDay(2)}', '${atDay(5)}', 'pending'),
              ('52000000-0000-4000-8000-000000000102', $1, $2, 7001, '${atDay(2)}', '${atDay(5)}', 'cancelled')`, [componentId, borrower]);
    await pool.query(
      `insert into public.reservation_resources (reservation_id, resource_item_id, lab_id, start_at, end_at, status)
       select id, item_id, lab_id, start_at, end_at, status from public.reservations where id in
       ('52000000-0000-4000-8000-000000000101', '52000000-0000-4000-8000-000000000102')`);
    await expect(reserve(componentId, atDay(3), atDay(4)))
      .resolves.toMatchObject({ status: "confirmed" });
  });

  it("prevents kit and individual-component conflicts in either booking order", async () => {
    const contents = [{ tracked_item_id: componentId, status: "available", is_restricted: false }];
    await reserve(kitId, atDay(2), atDay(5), contents);
    await expect(reserve(componentId, atDay(3), atDay(4)))
      .rejects.toMatchObject({ status: 409, code: "reservation_conflict" });
    await clearTestReservations();
    await reserve(componentId, atDay(3), atDay(4));
    await expect(reserve(kitId, atDay(2), atDay(5), contents))
      .rejects.toMatchObject({ status: 409, code: "reservation_conflict" });
  });

  it("keeps active kit reservation resources when components are added or later removed", async () => {
    await reserve(kitId, atDay(2), atDay(4), [{ tracked_item_id: componentId, status: "available", is_restricted: false }]);
    await pool.query(
      `insert into public.kit_components (kit_item_id, lab_id, component_name, tracked_item_id)
       values ($1, 7001, 'Reservation Test Component Two', $2)`, [kitId, secondComponentId]);
    await expect(reserve(secondComponentId, atDay(3), atDay(5)))
      .rejects.toMatchObject({ status: 409, code: "reservation_conflict" });
    await pool.query("update public.kit_components set is_active = false where kit_item_id = $1 and tracked_item_id = $2", [kitId, secondComponentId]);
    expect((await pool.query(
      "select 1 from public.reservation_resources where resource_item_id = $1 and status = 'confirmed'",
      [secondComponentId],
    )).rowCount).toBe(1);
    await expect(reserve(secondComponentId, atDay(3), atDay(5)))
      .rejects.toMatchObject({ status: 409, code: "reservation_conflict" });
    await expect(reserve(secondComponentId, atDay(4), atDay(5)))
      .resolves.toMatchObject({ status: "confirmed" });
  });

  it("serializes concurrent attempts and keeps today's equipment status unchanged", async () => {
    const outcomes = await Promise.allSettled([
      reserve(componentId, atDay(2), atDay(4)),
      reserve(componentId, atDay(3), atDay(5)),
    ]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
    const rejection = outcomes.find(result => result.status === "rejected");
    expect(rejection).toMatchObject({ status: "rejected", reason: { status: 409, code: "reservation_conflict" } });
    expect((await pool.query("select status from public.equipment_items where id = $1", [componentId])).rows[0].status).toBe("available");
  });
});
