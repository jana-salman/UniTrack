import type { ReturnStatus } from "./rules";

export type EquipmentStatus =
  | "available"
  | "reserved"
  | "checked_out"
  | "inspection_required"
  | "under_maintenance"
  | "retired"
  | "lost"
  | "overdue";

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

export interface ReturnOutcome {
  loanId: string;
  returnedAt: string;
  status: ReturnStatus;
  isLate: boolean;
}

export interface ReturnEquipmentComponent {
  id: string;
  name: string;
}