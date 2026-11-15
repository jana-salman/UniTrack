import type { EquipmentStatus } from "@unitrack/contracts";
export type { EquipmentStatus, ReturnOutcome } from "@unitrack/contracts";

export interface ReturnEquipmentItem {
  id: string;
  name: string;
  labId: number;
  status: EquipmentStatus;
}

export interface ReturnStatusChange {
  itemId: string;
  labId: number;
  changedBy: string;
  status: EquipmentStatus;
  expectedStatus: EquipmentStatus[];
  expectedOperationKey?: string;
  idempotencyKey: string;
  reason: string;
}

export interface ReturnEquipmentPort {
  getItem(
    itemId: string,
    labId: number,
  ): Promise<ReturnEquipmentItem | null>;

  changeStatus(
    input: ReturnStatusChange,
  ): Promise<{ changed: boolean }>;

  getComponents(
    itemId: string,
    labId: number,
  ): Promise<ReturnEquipmentComponent[]>;
}

export interface ReturnEquipmentComponent {
  id: string;
  name: string;
}
