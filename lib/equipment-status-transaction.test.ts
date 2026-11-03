
import test from "node:test";
import assert from "node:assert/strict";
import {
  updateEquipmentStatus,
  type StatusDatabaseClient,
} from "./equipment-status-transaction.ts";

const itemId = "550e8400-e29b-41d4-a716-446655440000";
const userId = "550e8400-e29b-41d4-a716-446655440001";

function createMockDatabase(
  currentStatus: string,
  failOnInsert = false
) {
  const queries: string[] = [];

  const db: StatusDatabaseClient = {
    async query(sql: string) {
      queries.push(sql.trim());

      if (sql.includes("SELECT id, lab_id, status")) {
        return {
          rows: [{ id: itemId, lab_id: 1, status: currentStatus }],
        };
      }

      if (
        failOnInsert &&
        sql.includes("INSERT INTO public.equipment_status_history")
      ) {
        throw new Error("History insert failed");
      }

      return { rows: [] };
    },
  };

  return { db, queries };
}

test("updates status and records history", async () => {
  const { db, queries } = createMockDatabase("available");

  const result = await updateEquipmentStatus(
    db,
    itemId,
    "under_maintenance",
    userId,
    "Needs repair"
  );

  assert.equal(result.changed, true);
  assert.equal(result.status, "under_maintenance");
  assert.ok(queries.some((q) => q.startsWith("UPDATE")));
  assert.ok(queries.some((q) => q.startsWith("INSERT")));
  assert.equal(queries.at(-1), "COMMIT");
});

test("does not record history when status is unchanged", async () => {
  const { db, queries } = createMockDatabase("available");

  const result = await updateEquipmentStatus(
    db,
    itemId,
    "available",
    userId
  );

  assert.equal(result.changed, false);
  assert.equal(queries.some((q) => q.startsWith("UPDATE")), false);
  assert.equal(queries.some((q) => q.startsWith("INSERT")), false);
  assert.equal(queries.at(-1), "COMMIT");
});

test("rolls back when history insertion fails", async () => {
  const { db, queries } = createMockDatabase("available", true);

  await assert.rejects(
    updateEquipmentStatus(
      db,
      itemId,
      "checked_out",
      userId
    ),
    /History insert failed/
  );

  assert.equal(queries.at(-1), "ROLLBACK");
});
