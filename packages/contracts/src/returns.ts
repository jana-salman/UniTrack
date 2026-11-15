export type ConditionStatus =
  | "good"
  | "damaged"
  | "missing"
  | "unknown";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isConditionStatus(value: unknown): value is ConditionStatus {
  return typeof value === "string" && ["good", "damaged", "missing", "unknown"].includes(value);
}

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

export interface ReturnLoanWire {
  id: string;
  item_id: string;
  borrower_id: string;
  reservation_id: string | null;
  lab_id: number;
  borrowed_at: string;
  due_date: string;
  returned_at: string | null;
}

export interface ReturnDetails {
  loan: ReturnLoanWire;
  pickupConditions: PickupCondition[];
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isReturnDetails(value: unknown): value is ReturnDetails {
  if (!isRecord(value) || !isRecord(value.loan) || !Array.isArray(value.pickupConditions)) return false;
  const loan = value.loan;
  const validLoan = typeof loan.id === "string" && UUID_PATTERN.test(loan.id)
    && typeof loan.item_id === "string" && UUID_PATTERN.test(loan.item_id)
    && typeof loan.borrower_id === "string" && UUID_PATTERN.test(loan.borrower_id)
    && (loan.reservation_id === null
      || (typeof loan.reservation_id === "string" && UUID_PATTERN.test(loan.reservation_id)))
    && Number.isSafeInteger(loan.lab_id) && (loan.lab_id as number) > 0
    && isDateString(loan.borrowed_at)
    && isDateString(loan.due_date)
    && (loan.returned_at === null || isDateString(loan.returned_at));
  return validLoan && value.pickupConditions.every(condition => {
    if (!isRecord(condition)) return false;
    return typeof condition.id === "string" && UUID_PATTERN.test(condition.id)
      && (condition.kit_component_id === null
        || (typeof condition.kit_component_id === "string" && UUID_PATTERN.test(condition.kit_component_id)))
      && isConditionStatus(condition.condition_status)
      && (condition.notes === null || typeof condition.notes === "string");
  });
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

export function isReturnOutcome(value: unknown): value is ReturnOutcome {
  if (!isRecord(value)) return false;
  return typeof value.loanId === "string" && UUID_PATTERN.test(value.loanId)
    && isDateString(value.returnedAt)
    && typeof value.status === "string"
    && ["available", "reserved", "inspection_required"].includes(value.status)
    && typeof value.isLate === "boolean";
}
