export type ConditionStatus =
  | "good"
  | "damaged"
  | "missing"
  | "unknown";

export interface ReturnLoan {
  id: string;
  item_id: string;
  borrower_id: string;
  reservation_id: string | null;
  lab_id: number;
  borrowed_at: Date;
  due_date: Date;
  returned_at: Date | null;
}

export interface PickupCondition {
  id: string;
  kit_component_id: string | null;
  condition_status: ConditionStatus;
  notes: string | null;
}

export interface ConfirmReturnInput {
  conditions: ReturnConditionInput[];
}

export interface ReturnConditionInput {
  kitComponentId: string | null;
  conditionStatus: ConditionStatus;
  notes?: string;
  newDamage?: boolean;
}
export type ReturnStatus = "available" | "reserved" | "inspection_required";
export interface ReturnOutcome { loanId: string; returnedAt: string; status: ReturnStatus; isLate: boolean }
