import "server-only";

import { getDatabasePool } from "@/lib/db";
import { updateEquipmentStatus } from "@/lib/equipment-status-transaction";

import type {
  EquipmentStatus,
  ReturnEquipmentItem,
  ReturnEquipmentPort,
} from "@/lib/returns/equipment-port";

interface EquipmentRow {
  id: string;
  lab_id: number;
  status: EquipmentStatus;
}

export const returnEquipmentClient: ReturnEquipmentPort = {
  async getItem(itemId, labId): Promise<ReturnEquipmentItem | null> {
    const result = await getDatabasePool().query<EquipmentRow>(
      `select id, lab_id, status
       from public.equipment_items
       where id = $1 and lab_id = $2`,
      [itemId, labId],
    );

    const item = result.rows[0];

    if (!item) {
      return null;
    }

    return {
      id: item.id,
      labId: item.lab_id,
      status: item.status,
    };
  },

  async changeStatus(input) {
    const client = await getDatabasePool().connect();

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
          idempotencyKey: input.idempotencyKey,
        },
      );

      return { changed: result.changed };
    } finally {
      client.release();
    }
  },
};