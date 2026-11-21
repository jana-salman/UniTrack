import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserIdentity } from "@unitrack/contracts";
import {
  EquipmentStatusConflictError,
  IdempotencyKeyConflictError,
  updateEquipmentStatus,
} from "../../equipment/lib/equipment-status-transaction";
import type {
  EquipmentStatus,
  ReturnStatusChange,
} from "../lib/returns/equipment-port";

vi.mock("server-only", () => ({}));

const database = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("../lib/db", () => ({
  getDatabasePool: () => {
    if (!database.pool) throw new Error("Local integration pool is not ready");
    return database.pool;
  },
}));

import { confirmReturn } from "../lib/returns/service";

const expectedDatabaseUrl =
  "postgresql://unitrack_local_test:local_test_only@127.0.0.1:55433/unitrack_test";
const configuredDatabaseUrl = process.env.UNITRACK_TEST_DATABASE_URL;
const localDescribe = configuredDatabaseUrl ? describe.sequential : describe.skip;

const assistantId = "00000000-0000-4000-8000-000000000001";
const borrowerId = "00000000-0000-4000-8000-000000000002";
const migrationItemId = "00000000-0000-4000-8000-000000000101";
const returnItemId = "00000000-0000-4000-8000-000000000102";
const loanId = "00000000-0000-4000-8000-000000000201";
const legacyReturnedLoanId = "00000000-0000-4000-8000-000000000202";
const labId = 7001;

let pool: Pool;
let loansPool: Pool;

function restricted(role: string): Pool {
  return new Pool({
    connectionString: configuredDatabaseUrl,
    max: 6,
    options: `-c role=${role}`,
  });
}

async function changeStatus(
  itemId: string,
  status: EquipmentStatus,
  options: Parameters<typeof updateEquipmentStatus>[6],
) {
  const client = await pool.connect();
  try {
    return await updateEquipmentStatus(
      client,
      itemId,
      status,
      assistantId,
      labId,
      "Disposable local integration test",
      options,
    );
  }
  finally {
    client.release();
  }
}

localDescribe("migrations 003-006 and S2-02 on disposable PostgreSQL", () => {
  beforeAll(async () => {
    if (configuredDatabaseUrl !== expectedDatabaseUrl) {
      throw new Error(
        "Refusing database integration test: use only database/local-test/run.ps1",
      );
    }
    pool = new Pool({ connectionString: configuredDatabaseUrl, max: 6 });
    loansPool = restricted("unitrack_loans_service");
    database.pool = loansPool;
    await Promise.all([pool.query("select 1"), loansPool.query("select 1")]);
  });

  afterAll(async () => {
    database.pool = null;
    await Promise.all([pool?.end(), loansPool?.end()]);
  });

  it("has the migrated columns, valid indexes, and enabled migration triggers", async () => {
    const columns = await pool.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
      `select table_name, column_name, data_type, is_nullable
       from information_schema.columns
       where table_schema = 'public'
         and (table_name, column_name) in (
           ('equipment_status_history', 'request_fingerprint'),
           ('loans', 'return_operation'),
           ('equipment_items', 'status_request_key')
         )
       order by table_name, column_name`,
    );
    expect(columns.rows).toEqual([
      { table_name: "equipment_items", column_name: "status_request_key", data_type: "text", is_nullable: "YES" },
      { table_name: "equipment_status_history", column_name: "request_fingerprint", data_type: "text", is_nullable: "YES" },
      { table_name: "loans", column_name: "return_operation", data_type: "jsonb", is_nullable: "YES" },
    ]);

    const objects = await pool.query<{ valid_indexes: number; enabled_triggers: number }>(
      `select
         (select count(*)::int from pg_index
          where indexrelid in (
            'public.equipment_status_history_request_key_unique'::regclass,
            'public.loans_one_active_per_item'::regclass
          ) and indisunique and indisvalid and indisready) as valid_indexes,
         (select count(*)::int from pg_trigger
          where tgname in ('equipment_status_owner_clear', 'equipment_status_owner_record')
            and tgenabled <> 'D' and not tgisinternal) as enabled_triggers`,
    );
    expect(objects.rows[0]).toEqual({ valid_indexes: 2, enabled_triggers: 2 });

    await expect(pool.query(
      `insert into public.equipment_status_history
       (item_id, lab_id, old_status, new_status, changed_by, request_key, request_fingerprint)
       values ($1, $2, 'available', 'available', $3, 'local:legacy:receipt', 'duplicate')`,
      [migrationItemId, labId, assistantId],
    )).rejects.toMatchObject({
      code: "23505",
      constraint: "equipment_status_history_request_key_unique",
    });

    await expect(pool.query(
      `insert into public.loans (item_id, borrower_id, lab_id, due_date)
       values ($1, $2, $3, '2099-02-01T00:00:00Z')`,
      [returnItemId, borrowerId, labId],
    )).rejects.toMatchObject({ code: "23505", constraint: "loans_one_active_per_item" });

    await expect(pool.query(
      "update public.equipment_status_history set reason = 'forbidden' where request_key = 'local:legacy:receipt'",
    )).rejects.toMatchObject({ code: "P0001" });
  });

  it("enforces replay fingerprints and operation ownership through real triggers", async () => {
    const apply = await changeStatus(migrationItemId, "checked_out", {
      expectedStatus: ["available"],
      idempotencyKey: "local:equipment:apply",
      trackOperation: true,
    });
    expect(apply).toMatchObject({ changed: true, status: "checked_out" });

    const ownerAfterApply = await pool.query<{ status_request_key: string | null }>(
      "select status_request_key from public.equipment_items where id = $1",
      [migrationItemId],
    );
    expect(ownerAfterApply.rows[0].status_request_key).toBe("local:equipment:apply");

    await expect(changeStatus(migrationItemId, "checked_out", {
      expectedStatus: ["available"],
      idempotencyKey: "local:equipment:apply",
      trackOperation: true,
    })).resolves.toMatchObject({ alreadyApplied: true, changed: true });
    await expect(changeStatus(migrationItemId, "available", {
      expectedStatus: ["checked_out"],
      idempotencyKey: "local:equipment:apply",
      trackOperation: true,
    })).rejects.toBeInstanceOf(IdempotencyKeyConflictError);

    await pool.query(
      "update public.equipment_items set status = 'available' where id = $1",
      [migrationItemId],
    );
    const cleared = await pool.query<{ status_request_key: string | null }>(
      "select status_request_key from public.equipment_items where id = $1",
      [migrationItemId],
    );
    expect(cleared.rows[0].status_request_key).toBeNull();

    await expect(changeStatus(migrationItemId, "available", {
      expectedStatus: ["available"],
      idempotencyKey: "local:equipment:no-op",
      trackOperation: true,
    })).resolves.toMatchObject({ changed: false });

    await changeStatus(migrationItemId, "checked_out", {
      expectedStatus: ["available"],
      idempotencyKey: "local:equipment:aba-a",
      trackOperation: true,
    });
    await changeStatus(migrationItemId, "available", {
      expectedStatus: ["checked_out"],
      idempotencyKey: "local:equipment:aba-b",
      trackOperation: true,
    });
    const historyBeforeStaleUndo = await pool.query<{ count: number }>(
      "select count(*)::int as count from public.equipment_status_history",
    );

    await expect(changeStatus(migrationItemId, "checked_out", {
      expectedStatus: ["available"],
      expectedOperationKey: "local:equipment:aba-a",
      idempotencyKey: "local:equipment:stale-undo",
      trackOperation: true,
    })).rejects.toBeInstanceOf(EquipmentStatusConflictError);

    const afterStaleUndo = await pool.query<{ status: string; status_request_key: string | null; history_count: number }>(
      `select status, status_request_key,
         (select count(*)::int from public.equipment_status_history) as history_count
       from public.equipment_items where id = $1`,
      [migrationItemId],
    );
    expect(afterStaleUndo.rows[0]).toEqual({
      status: "available",
      status_request_key: "local:equipment:aba-b",
      history_count: historyBeforeStaleUndo.rows[0].count,
    });
  });

  it("enforces custody permissions and recovery transitions as the restricted Loans role", async () => {
    const client = await loansPool.connect();
    try {
      await client.query("BEGIN");

      // Pickup INSERT remains available after migration 007.
      await client.query(
        `insert into public.condition_records
         (id, loan_id, item_id, lab_id, phase, condition_status, notes, recorded_by)
         values ('00000000-0000-4000-8000-000000000302', $1, $2, $3,
                 'pickup', 'good', 'Restricted-role pickup check', $4)`,
        [loanId, returnItemId, labId, assistantId],
      );

      await client.query("SAVEPOINT condition_update");
      await expect(client.query(
        "update public.condition_records set notes = 'forbidden' where id = '00000000-0000-4000-8000-000000000302'",
      )).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK TO SAVEPOINT condition_update");

      await client.query("SAVEPOINT condition_delete");
      await expect(client.query(
        "delete from public.condition_records where id = '00000000-0000-4000-8000-000000000302'",
      )).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK TO SAVEPOINT condition_delete");

      await client.query("SAVEPOINT immutable_loan");
      await expect(client.query(
        "update public.loans set due_date = due_date + interval '1 day' where id = $1",
        [loanId],
      )).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK TO SAVEPOINT immutable_loan");

      const operation = {
        fingerprint: "c".repeat(64),
        key: "return:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        attempt: 0,
        actor: assistantId,
        previous: "checked_out",
        state: "planned",
        result: {
          loanId,
          status: "available",
          isLate: false,
          returnedAt: "2026-11-19T14:00:00.000Z",
        },
      };
      await client.query(
        "update public.loans set return_operation = $1::jsonb where id = $2",
        [JSON.stringify(operation), loanId],
      );
      // Exercise recovery from planned and applied, resume compensating, then
      // a compensated retry with the required attempt increment.
      for (const state of ["applied", "compensating", "compensated"] as const) {
        await client.query(
          "update public.loans set return_operation = jsonb_set(return_operation, '{state}', to_jsonb($1::text)) where id = $2",
          [state, loanId],
        );
      }
      await client.query(
        `update public.loans
         set return_operation = jsonb_set(
               jsonb_set(return_operation, '{state}', '"planned"'::jsonb),
               '{attempt}', '1'::jsonb)
         where id = $1`,
        [loanId],
      );
      const recovered = await client.query<{ state: string; attempt: number }>(
        `select return_operation ->> 'state' as state,
                (return_operation ->> 'attempt')::int as attempt
         from public.loans where id = $1`,
        [loanId],
      );
      expect(recovered.rows[0]).toEqual({ state: "planned", attempt: 1 });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("rejects a committed applied operation with returned_at and preserves legacy returned loans", async () => {
    const client = await loansPool.connect();
    try {
      const operation = {
        fingerprint: "d".repeat(64),
        key: "return:dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        attempt: 0,
        actor: assistantId,
        previous: "checked_out",
        state: "planned",
        result: {
          loanId,
          status: "available",
          isLate: false,
          returnedAt: "2026-11-19T15:00:00.000Z",
        },
      };
      await client.query("BEGIN");
      await client.query(
        "update public.loans set return_operation = $1::jsonb where id = $2",
        [JSON.stringify(operation), loanId],
      );
      await client.query(
        "update public.loans set return_operation = jsonb_set(return_operation, '{state}', to_jsonb($1::text)) where id = $2",
        ["applied", loanId],
      );
      await client.query(
        "update public.loans set returned_at = $1 where id = $2",
        [operation.result.returnedAt, loanId],
      );
      await expect(client.query("COMMIT")).rejects.toMatchObject({
        code: "P0001",
        message: "Committed return requires a matching completed return operation",
      });
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }

    expect((await pool.query<{ returned_at: Date | null; return_operation: unknown }>(
      "select returned_at, return_operation from public.loans where id = $1",
      [loanId],
    )).rows[0]).toEqual({ returned_at: null, return_operation: null });

    // An already-returned legacy row is not required to gain a synthetic
    // return_operation and its unchanged timestamp remains valid.
    await pool.query(
      `insert into public.loans
       (id, item_id, borrower_id, lab_id, borrowed_at, due_date, returned_at)
       values ($1, $2, $3, $4, '2026-01-01T00:00:00Z',
               '2026-02-01T00:00:00Z', '2026-01-15T00:00:00Z')`,
      [legacyReturnedLoanId, migrationItemId, borrowerId, labId],
    );
    await expect(loansPool.query(
      "update public.loans set returned_at = returned_at where id = $1",
      [legacyReturnedLoanId],
    )).resolves.toMatchObject({ rowCount: 1 });
  });

  it("runs normal completion and replay as the restricted Loans role", async () => {
    const equipment = {
      getComponents: async () => [],
      getItem: async (itemId: string, requestedLabId: number) => {
        const result = await pool.query<{ id: string; name: string; lab_id: number; status: EquipmentStatus }>(
          "select id, name, lab_id, status from public.equipment_items where id = $1 and lab_id = $2",
          [itemId, requestedLabId],
        );
        const item = result.rows[0];
        return item ? { id: item.id, name: item.name, labId: item.lab_id, status: item.status } : null;
      },
      changeStatus: async (input: ReturnStatusChange) => {
        const client: PoolClient = await pool.connect();
        try {
          const result = await updateEquipmentStatus(
            client,
            input.itemId,
            input.status,
            input.changedBy,
            input.labId,
            input.reason,
            {
              expectedStatus: input.expectedStatus,
              expectedOperationKey: input.expectedOperationKey,
              idempotencyKey: input.idempotencyKey,
              trackOperation: true,
            },
          );
          return { changed: result.changed };
        }
        finally {
          client.release();
        }
      },
    };
    const actor: UserIdentity = {
      kind: "user",
      sub: assistantId,
      role: "lab_assistant",
      lab_id: labId,
      rid: "local-postgres-test",
    };
    const input = {
      conditions: [{ kitComponentId: null, conditionStatus: "good" as const }],
    };

    const first = await confirmReturn(loanId, input, actor, equipment);
    expect(first).toMatchObject({ loanId, status: "available", isLate: false });

    const evidence = await pool.query<{
      returned_at: Date | null;
      operation_state: string | null;
      status: string;
      status_request_key: string | null;
      return_records: number;
      keyed_receipts: number;
      fingerprint_length: number | null;
    }>(
      `select l.returned_at,
         l.return_operation ->> 'state' as operation_state,
         i.status,
         i.status_request_key,
         (select count(*)::int from public.condition_records
          where loan_id = l.id and phase = 'return') as return_records,
         (select count(*)::int from public.equipment_status_history
          where item_id = i.id and request_key = i.status_request_key) as keyed_receipts,
         (select length(request_fingerprint)::int from public.equipment_status_history
          where item_id = i.id and request_key = i.status_request_key) as fingerprint_length
       from public.loans l
       join public.equipment_items i on i.id = l.item_id
       where l.id = $1`,
      [loanId],
    );
    expect(evidence.rows[0]).toMatchObject({
      operation_state: "completed",
      status: "available",
      return_records: 1,
      keyed_receipts: 1,
      fingerprint_length: 64,
    });
    expect(evidence.rows[0].returned_at).toBeInstanceOf(Date);
    expect(evidence.rows[0].status_request_key).toMatch(/^return:[a-f0-9-]{36}:0:apply$/);

    await expect(confirmReturn(loanId, input, actor, equipment)).resolves.toEqual(first);
    const replayCounts = await pool.query<{ return_records: number; keyed_receipts: number }>(
      `select
         (select count(*)::int from public.condition_records
          where loan_id = $1 and phase = 'return') as return_records,
         (select count(*)::int from public.equipment_status_history
          where item_id = $2 and request_key like 'return:%') as keyed_receipts`,
      [loanId, returnItemId],
    );
    expect(replayCounts.rows[0]).toEqual({ return_records: 1, keyed_receipts: 1 });
  });
  it("prevents overlapping confirmed reservations for the same equipment item", async () => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Existing pending and cancelled reservations must not block
      // a new confirmed reservation for the same equipment item.
      await client.query(
        `INSERT INTO public.reservations
         (item_id, borrower_id, lab_id, start_at, end_at, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [migrationItemId, borrowerId, labId, "2098-06-01T10:15:00Z", "2098-06-01T10:45:00Z"],
      );

      await client.query(
        `INSERT INTO public.reservations
         (item_id, borrower_id, lab_id, start_at, end_at, status)
         VALUES ($1, $2, $3, $4, $5, 'cancelled')`,
        [migrationItemId, borrowerId, labId, "2098-06-01T10:15:00Z", "2098-06-01T10:45:00Z"],
      );

      const itemOne = migrationItemId;
      const itemTwo = returnItemId;

      // First confirmed reservation: 10:00–11:00.
      await client.query(
        `INSERT INTO public.reservations
         (item_id, borrower_id, lab_id, start_at, end_at, status)
         VALUES ($1, $2, $3, $4, $5, 'confirmed')`,
        [itemOne, borrowerId, labId, "2098-06-01T10:00:00Z", "2098-06-01T11:00:00Z"],
      );

      // Overlapping confirmed reservation for the same item must fail.
      await client.query("SAVEPOINT overlapping_attempt");

      await expect(
        client.query(
          `INSERT INTO public.reservations
           (item_id, borrower_id, lab_id, start_at, end_at, status)
           VALUES ($1, $2, $3, $4, $5, 'confirmed')`,
          [itemOne, borrowerId, labId, "2098-06-01T10:30:00Z", "2098-06-01T11:30:00Z"],
        ),
      ).rejects.toMatchObject({
        code: "23P01",
        constraint: "reservations_no_overlapping_confirmed",
      });

      await client.query("ROLLBACK TO SAVEPOINT overlapping_attempt");

      // Consecutive reservations for the same item must be allowed.
      await client.query(
        `INSERT INTO public.reservations
         (item_id, borrower_id, lab_id, start_at, end_at, status)
         VALUES ($1, $2, $3, $4, $5, 'confirmed')`,
        [itemOne, borrowerId, labId, "2098-06-01T11:00:00Z", "2098-06-01T12:00:00Z"],
      );

      // Different equipment items may be reserved at the same time.
      await client.query(
        `INSERT INTO public.reservations
         (item_id, borrower_id, lab_id, start_at, end_at, status)
         VALUES ($1, $2, $3, $4, $5, 'confirmed')`,
        [itemTwo, borrowerId, labId, "2098-06-01T10:30:00Z", "2098-06-01T11:30:00Z"],
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
