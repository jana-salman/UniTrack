
import test from "node:test";
import assert from "node:assert/strict";
import {
  updateEquipmentStatus,
  type StatusDatabaseClient,
} from "./equipment-status-transaction";

const itemId = "550e8400-e29b-41d4-a716-446655440000";
const userId = "550e8400-e29b-41d4-a716-446655440001";
const labId = 1;

function createMockDatabase(
  currentStatus: string,
  options: {
    failOnInsert?: boolean;
    itemLabId?: number;
    itemExists?: boolean;
  } = {}
) {
  const queries: { sql: string; values: unknown[] }[] = [];

  const db: StatusDatabaseClient = {
    async query(sql: string, values: unknown[] = []) {
      const trimmedSql = sql.trim();
      queries.push({ sql: trimmedSql, values });

      if (trimmedSql.startsWith("SELECT")) {
        const itemLabId = options.itemLabId ?? labId;
        const isAllowed = values[1] === itemLabId;

        return {
          rows:
            options.itemExists === false || !isAllowed
              ? []
              : [{ id: itemId, lab_id: itemLabId, status: currentStatus }],
        };
      }

      if (
        options.failOnInsert &&
        trimmedSql.startsWith("INSERT")
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
    labId,
    "Needs repair"
  );

  assert.equal(result.changed, true);
  assert.equal(result.status, "under_maintenance");

  const update = queries.find((q) => q.sql.startsWith("UPDATE"));
  const insert = queries.find((q) => q.sql.startsWith("INSERT"));

  assert.ok(update);
  assert.ok(insert);
  assert.deepEqual(update.values, ["under_maintenance", itemId, labId]);
  assert.deepEqual(insert.values, [
    itemId,
    labId,
    "available",
    "under_maintenance",
    userId,
    "Needs repair",
  ]);
  assert.equal(queries.at(-1)?.sql, "COMMIT");
});

test("does not record history when status is unchanged", async () => {
  const { db, queries } = createMockDatabase("available");

  const result = await updateEquipmentStatus(
    db,
    itemId,
    "available",
    userId,
    labId
  );

  assert.equal(result.changed, false);
  assert.equal(queries.some((q) => q.sql.startsWith("UPDATE")), false);
  assert.equal(queries.some((q) => q.sql.startsWith("INSERT")), false);
  assert.equal(queries.at(-1)?.sql, "COMMIT");
});

test("rolls back when history insertion fails", async () => {
  const { db, queries } = createMockDatabase("available", {
    failOnInsert: true,
  });

  await assert.rejects(
    updateEquipmentStatus(db, itemId, "checked_out", userId, labId),
    /History insert failed/
  );

  assert.equal(queries.at(-1)?.sql, "ROLLBACK");
});

test("rejects equipment belonging to another laboratory", async () => {
  const { db, queries } = createMockDatabase("available", {
    itemLabId: 2,
  });

  await assert.rejects(
    updateEquipmentStatus(db, itemId, "retired", userId, labId),
    /Equipment item not found or access denied/
  );

  assert.equal(queries.some((q) => q.sql.startsWith("UPDATE")), false);
  assert.equal(queries.some((q) => q.sql.startsWith("INSERT")), false);
  assert.equal(queries.at(-1)?.sql, "ROLLBACK");
});

test("rejects invalid laboratory IDs", async () => {
  const { db, queries } = createMockDatabase("available");

  await assert.rejects(
    updateEquipmentStatus(db, itemId, "checked_out", userId, 0),
    /Invalid laboratory ID/
  );

  assert.equal(queries.length, 0);
});

test("rejects nonexistent equipment", async () => {
  const { db, queries } = createMockDatabase("available", {
    itemExists: false,
  });

  await assert.rejects(
    updateEquipmentStatus(db, itemId, "retired", userId, labId),
    /Equipment item not found or access denied/
  );

  assert.equal(queries.at(-1)?.sql, "ROLLBACK");
});
