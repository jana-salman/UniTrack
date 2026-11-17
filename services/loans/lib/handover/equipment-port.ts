import type { ReturnEquipmentItem, ReturnStatusChange } from "../returns/equipment-port";

/** Authoritative kit component as read from Equipment over HTTP. */
export interface HandoverKitComponent {
  id: string;
  name: string;
  isActive: boolean;
  isRequired: boolean;
}

/**
 * Handover needs the same item read and keyed status change as Return, plus
 * the kit's component list. Equipment remains the only writer of item status.
 */
export interface HandoverEquipmentPort {
  getItem(itemId: string, labId: number): Promise<ReturnEquipmentItem | null>;
  changeStatus(input: ReturnStatusChange): Promise<{ changed: boolean }>;
  getKitComponents(itemId: string, labId: number): Promise<HandoverKitComponent[]>;
}
