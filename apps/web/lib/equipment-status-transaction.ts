
import { validateStatusChange } from "./equipment-status-change";

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
  labId: number,
  reason?: string
) {
  const input = validateStatusChange(itemId, newStatus, reason);

  if (!Number.isInteger(labId) || labId <= 0) {
    throw new Error("Invalid laboratory ID");
  }

  await db.query("BEGIN");

  try {
    const result = await db.query(
      `SELECT id, lab_id, status
       FROM public.equipment_items
       WHERE id = $1 AND lab_id = $2
       FOR UPDATE`,
      [input.itemId, labId]
    );

    if (result.rows.length === 0) {
      throw new Error("Equipment item not found or access denied");
    }

    const item = result.rows[0];
    const oldStatus = item.status as string;

    if (oldStatus === input.newStatus) {
      await db.query("COMMIT");
      return {
        itemId: input.itemId,
        status: oldStatus,
        changed: false,
      };
    }

    await db.query(
      `UPDATE public.equipment_items
       SET status = $1
       WHERE id = $2 AND lab_id = $3`,
      [input.newStatus, input.itemId, labId]
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

    return {
      itemId: input.itemId,
      status: input.newStatus,
      changed: true,
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
