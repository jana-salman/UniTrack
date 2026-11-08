import "server-only";

import { getDatabasePool } from "@/lib/db";
import { updateEquipmentStatus } from "@/lib/equipment-status-transaction";

import type {
  EquipmentStatus,
  ReturnEquipmentItem,
  ReturnEquipmentPort,
  ReturnEquipmentComponent
} from "@/lib/returns/equipment-port";

interface EquipmentRow {
  id: string;
  name: string;
  lab_id: number;
  status: EquipmentStatus;
}

export const returnEquipmentClient: ReturnEquipmentPort = {
  async getItem(itemId, labId): Promise<ReturnEquipmentItem | null> {
    const result = await getDatabasePool().query<EquipmentRow>(
      `select id, name, lab_id, status
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
      name: item.name,
      labId: item.lab_id,
      status: item.status,
    };
  },
  
  async getComponents(
    itemId,
    labId,
  ): Promise<ReturnEquipmentComponent[]> {
    const result = await getDatabasePool().query<{
      id: string;
      component_name: string;
    }>(
      `select id, component_name
       from public.kit_components
       where kit_item_id = $1
         and lab_id = $2
       order by component_name, id`,
      [itemId, labId],
    );

    return result.rows.map((component) => ({
      id: component.id,
      name: component.component_name,
    }));
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