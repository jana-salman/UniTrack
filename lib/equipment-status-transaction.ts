
import {
  validateStatusChange,
} from "./equipment-status-change.ts";

export interface StatusDatabaseClient {
  query(
    sql: string,
    values?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function updateEquipmentStatus(
  db: StatusDatabaseClient,
  itemId: string,
  newStatus: string,
  changedBy: string,
  reason?: string
) {
  const input = validateStatusChange(itemId, newStatus, reason);

  await db.query("BEGIN");

  try {
    const result = await db.query(
      `SELECT id, lab_id, status
       FROM public.equipment_items
       WHERE id = $1
       FOR UPDATE`,
      [input.itemId]
    );

    if (result.rows.length === 0) {
      throw new Error("Equipment item not found");
    }

    const item = result.rows[0];
    const oldStatus = item.status as string;
    const labId = item.lab_id as number;

    if (oldStatus === input.newStatus) {
      await db.query("COMMIT");
      return { itemId: input.itemId, status: oldStatus, changed: false };
    }

    await db.query(
      `UPDATE public.equipment_items
       SET status = $1
       WHERE id = $2`,
      [input.newStatus, input.itemId]
    );

    await db.query(
      `INSERT INTO public.equipment_status_history
       (item_id, lab_id, old_status, new_status, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.itemId,
        labId,
        oldStatus,
        input.newStatus,
        changedBy,
        input.reason ?? null,
      ]
    );

    await db.query("COMMIT");

    return { itemId: input.itemId, status: input.newStatus, changed: true };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
