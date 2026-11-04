
import { test, expect } from "vitest";
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

      if (options.failOnInsert && trimmedSql.startsWith("INSERT")) {
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

  expect(result.changed).toBe(true);
  expect(result.status).toBe("under_maintenance");

  const update = queries.find((q) => q.sql.startsWith("UPDATE"));
  const insert = queries.find((q) => q.sql.startsWith("INSERT"));

  expect(update).toBeDefined();
  expect(insert).toBeDefined();
  expect(update?.values).toEqual(["under_maintenance", itemId, labId]);
  expect(insert?.values).toEqual([
    itemId,
    labId,
    "available",
    "under_maintenance",
    userId,
    "Needs repair",
  ]);
  expect(queries.at(-1)?.sql).toBe("COMMIT");
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

  expect(result.changed).toBe(false);
  expect(queries.some((q) => q.sql.startsWith("UPDATE"))).toBe(false);
  expect(queries.some((q) => q.sql.startsWith("INSERT"))).toBe(false);
  expect(queries.at(-1)?.sql).toBe("COMMIT");
});

test("rolls back when history insertion fails", async () => {
  const { db, queries } = createMockDatabase("available", {
    failOnInsert: true,
  });

  await expect(
    updateEquipmentStatus(db, itemId, "checked_out", userId, labId)
  ).rejects.toThrow("History insert failed");

  expect(queries.at(-1)?.sql).toBe("ROLLBACK");
});

test("rejects equipment belonging to another laboratory", async () => {
  const { db, queries } = createMockDatabase("available", {
    itemLabId: 2,
  });

  await expect(
    updateEquipmentStatus(db, itemId, "retired", userId, labId)
  ).rejects.toThrow("Equipment item not found or access denied");

  expect(queries.some((q) => q.sql.startsWith("UPDATE"))).toBe(false);
  expect(queries.some((q) => q.sql.startsWith("INSERT"))).toBe(false);
  expect(queries.at(-1)?.sql).toBe("ROLLBACK");
});

test("rejects invalid laboratory IDs", async () => {
  const { db, queries } = createMockDatabase("available");

  await expect(
    updateEquipmentStatus(db, itemId, "checked_out", userId, 0)
  ).rejects.toThrow("Invalid laboratory ID");

  expect(queries.length).toBe(0);
});

test("rejects nonexistent equipment", async () => {
  const { db, queries } = createMockDatabase("available", {
    itemExists: false,
  });

  await expect(
    updateEquipmentStatus(db, itemId, "retired", userId, labId)
  ).rejects.toThrow("Equipment item not found or access denied");

  expect(queries.at(-1)?.sql).toBe("ROLLBACK");
});
