import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const expectedUrl = "postgresql://unitrack_local_test:local_test_only@127.0.0.1:55432/unitrack_test";
const configuredUrl = process.env.UNITRACK_TEST_DATABASE_URL;
const localDescribe = configuredUrl ? describe.sequential : describe.skip;
const assistantId = "00000000-0000-4000-8000-000000000001";
const borrowerId = "00000000-0000-4000-8000-000000000002";
const labId = 7001;
let admin: Pool;
let loans: Pool;
const fixtures: Fixture[] = [];

interface Fixture {
  itemId: string;
  reservationId: string;
  loanId: string;
  startAt: Date;
  endAt: Date;
  borrowedAt: Date;
  operation: Record<string, unknown>;
}

function uuid(prefix: string, index: number) {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function restrictedLoansPool() {
  return new Pool({ connectionString: configuredUrl, max: 8, options: "-c role=unitrack_loans_service" });
}

async function seed(index: number, state: string): Promise<Fixture> {
  const itemId = uuid("53100000", index);
  const reservationId = uuid("53200000", index);
  const loanId = uuid("53300000", index);
  const startAt = new Date(Date.now() - 60_000);
  const endAt = new Date(Date.now() + 86_400_000);
  const borrowedAt = new Date();
  const operation = {
    fingerprint: "a".repeat(64),
    key: `handover:${uuid("53400000", index)}`,
    attempt: 0,
    actor: assistantId,
    idVerifiedBy: assistantId,
    previous: "reserved",
    state,
    conditions: [{ kitComponentId: null, checked: true, conditionStatus: "good", notes: "" }],
    checklistVersion: "b".repeat(64),
    window: { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
    result: {
      loanId,
      reservationId,
      itemId,
      borrowerId,
      borrowedAt: borrowedAt.toISOString(),
      dueDate: endAt.toISOString(),
      studentConfirmedAt: borrowedAt.toISOString(),
      universityIdVerifiedAt: borrowedAt.toISOString(),
      status: "checked_out",
    },
  };
  const fixture = { itemId, reservationId, loanId, startAt, endAt, borrowedAt, operation };
  fixtures.push(fixture);
  await admin.query(
    `insert into public.equipment_items (id, asset_code, name, category_id, lab_id, status, condition)
     values ($1, $2, $3, 7101, $4, 'reserved', 'good')`,
    [itemId, `LOCAL-GUARD-${index}`, `Reservation guard fixture ${index}`, labId],
  );
  await admin.query(
    `insert into public.reservations
       (id, item_id, borrower_id, lab_id, start_at, end_at, status, handover_operation)
     values ($1, $2, $3, $4, $5, $6, 'confirmed', $7::jsonb)`,
    [reservationId, itemId, borrowerId, labId, startAt, endAt, JSON.stringify(operation)],
  );
  return fixture;
}

async function completeHandover(client: PoolClient, fixture: Fixture) {
  const op = { ...fixture.operation, state: "completed" };
  await client.query(
    `insert into public.loans
       (id, item_id, borrower_id, reservation_id, lab_id, borrowed_at, due_date,
        student_confirmed_at, university_id_verified_at, university_id_verified_by)
     values ($1, $2, $3, $4, $5, $6, $7, $6, $6, $8)`,
    [fixture.loanId, fixture.itemId, borrowerId, fixture.reservationId, labId, fixture.borrowedAt, fixture.endAt, assistantId],
  );
  await client.query(
    `insert into public.condition_records
       (loan_id, item_id, lab_id, phase, condition_status, recorded_by)
     values ($1, $2, $3, 'pickup', 'good', $4)`,
    [fixture.loanId, fixture.itemId, labId, assistantId],
  );
  await client.query(
    `update public.reservations
        set status = 'fulfilled', handover_operation = $1::jsonb
      where id = $2`,
    [JSON.stringify(op), fixture.reservationId],
  );
}

async function runCompletion(fixture: Fixture) {
  const client = await loans.connect();
  try {
    await client.query("BEGIN");
    await client.query("select pg_advisory_xact_lock(hashtextextended('loans:item:' || $1::uuid::text, 0))", [fixture.itemId]);
    await client.query("select id from public.reservations where id = $1 for update", [fixture.reservationId]);
    await completeHandover(client, fixture);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function cleanup() {
  // The database intentionally makes loan and condition history undeletable.
  // These synthetic IDs are unique within this test file; the local harness
  // destroys the entire tmpfs-backed database after the suite.
  fixtures.length = 0;
}

localDescribe("reservation handover status guard on disposable PostgreSQL", () => {
  beforeAll(async () => {
    if (configuredUrl !== expectedUrl) throw new Error("Refusing PostgreSQL test: use only database/local-test/run.ps1.");
    admin = new Pool({ connectionString: configuredUrl, max: 8 });
    loans = restrictedLoansPool();
    await Promise.all([admin.query("select 1"), loans.query("select 1")]);
  });

  afterEach(cleanup);
  afterAll(async () => { await Promise.all([admin?.end(), loans?.end()]); });

  it("rejects status changes under the restricted Loans role while handover is planned, applied, or compensating", async () => {
    for (const [index, state] of (["planned", "applied", "compensating"] as const).entries()) {
      const fixture = await seed(index + 1, state);
      await expect(loans.query("update public.reservations set status = 'cancelled' where id = $1", [fixture.reservationId]))
        .rejects.toMatchObject({ code: "23514", constraint: "reservations_handover_status_protected" });
      await expect(loans.query("update public.reservations set status = 'expired' where id = $1", [fixture.reservationId]))
        .rejects.toMatchObject({ code: "23514", constraint: "reservations_handover_status_protected" });
      const saved = await admin.query("select status from public.reservations where id = $1", [fixture.reservationId]);
      expect(saved.rows[0].status).toBe("confirmed");
      await cleanup();
    }
  });

  it.each([
    { index: 4, kind: "normal handover" },
    { index: 5, kind: "recovery of an applied handover" },
  ])("allows the restricted Loans role to complete a legitimate $kind transaction", async ({ index }) => {
      const fixture = await seed(index, "applied");
      await runCompletion(fixture);
      const result = await admin.query("select status, handover_operation ->> 'state' as state from public.reservations where id = $1", [fixture.reservationId]);
      expect(result.rows[0]).toEqual({ status: "fulfilled", state: "completed" });
    });

  it("allows compensation state updates, blocks cancellation until compensation is confirmed, then permits it", async () => {
    const fixture = await seed(6, "applied");
    const client = await loans.connect();
    try {
      await client.query("update public.reservations set handover_operation = jsonb_set(handover_operation, '{state}', to_jsonb($1::text)) where id = $2", ["compensating", fixture.reservationId]);
      await expect(client.query("update public.reservations set status = 'cancelled' where id = $1", [fixture.reservationId]))
        .rejects.toMatchObject({ code: "23514", constraint: "reservations_handover_status_protected" });
      await client.query("update public.reservations set handover_operation = jsonb_set(handover_operation, '{state}', to_jsonb($1::text)) where id = $2", ["compensated", fixture.reservationId]);
      await client.query("update public.reservations set status = 'cancelled' where id = $1", [fixture.reservationId]);
      const result = await admin.query("select status, handover_operation ->> 'state' as state from public.reservations where id = $1", [fixture.reservationId]);
      expect(result.rows[0]).toEqual({ status: "cancelled", state: "compensated" });
    } finally {
      client.release();
    }
  });

  it("keeps fulfilled reservations terminal for every later status change", async () => {
    const fixture = await seed(7, "applied");
    await runCompletion(fixture);
    for (const status of ["cancelled", "confirmed", "expired"] as const) {
      await expect(loans.query("update public.reservations set status = $1 where id = $2", [status, fixture.reservationId]))
        .rejects.toMatchObject({ code: "23514", constraint: "reservations_fulfilled_status_terminal" });
    }
    expect((await admin.query("select status from public.reservations where id = $1", [fixture.reservationId])).rows[0].status).toBe("fulfilled");
  });

  it("serializes a future cancellation behind handover and rejects it after fulfillment", async () => {
    const fixture = await seed(8, "applied");
    const handover = await loans.connect();
    const cancellation = await loans.connect();
    try {
      await handover.query("BEGIN");
      await handover.query("select pg_advisory_xact_lock(hashtextextended('loans:item:' || $1::uuid::text, 0))", [fixture.itemId]);
      await handover.query("select id from public.reservations where id = $1 for update", [fixture.reservationId]);
      await completeHandover(handover, fixture);

      const cancelAttempt = (async () => {
        await cancellation.query("BEGIN");
        try {
          const peek = await cancellation.query("select item_id from public.reservations where id = $1", [fixture.reservationId]);
          await cancellation.query("select pg_advisory_xact_lock(hashtextextended('loans:item:' || $1::uuid::text, 0))", [peek.rows[0].item_id]);
          await cancellation.query("select id from public.reservations where id = $1 for update", [fixture.reservationId]);
          await cancellation.query("update public.reservations set status = 'cancelled' where id = $1", [fixture.reservationId]);
          await cancellation.query("COMMIT");
        } catch (error) {
          await cancellation.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
      })();

      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const locks = await admin.query("select count(*)::int as count from pg_locks where locktype = 'advisory' and not granted");
        if (locks.rows[0].count > 0) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await handover.query("COMMIT");
      await expect(cancelAttempt).rejects.toMatchObject({ code: "23514", constraint: "reservations_fulfilled_status_terminal" });
      expect((await admin.query("select status from public.reservations where id = $1", [fixture.reservationId])).rows[0].status).toBe("fulfilled");
    } catch (error) {
      await handover.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      handover.release();
      cancellation.release();
    }
  });
});
