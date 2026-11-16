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
  returnHistory?: ReturnHistory;
}

export interface RecordedReturnCondition {
  id: string;
  kitComponentId: string | null;
  conditionStatus: ConditionStatus;
  notes: string | null;
  recordedAt: string;
}
export interface ReturnHistory {
  returnedAt: string;
  isLate: boolean;
  conditions: RecordedReturnCondition[];
}
export interface ReturnProblemCondition {
  componentId: string | null;
  kind: "missing" | "new_damage";
  notes: string | null;
}
export interface OwnReturnProblem {
  loanId: string;
  itemId: string;
  returnedAt: string;
  problems: ReturnProblemCondition[];
}
export interface StudentReturnProblem extends OwnReturnProblem {
  itemName: string;
  problems: (ReturnProblemCondition & { label: string })[];
}

export function isReturnHistory(value: unknown): value is ReturnHistory {
  return isRecord(value) && isDateString(value.returnedAt) && typeof value.isLate === "boolean"
    && Array.isArray(value.conditions) && value.conditions.every(row => isRecord(row)
      && typeof row.id === "string" && UUID_PATTERN.test(row.id)
      && (row.kitComponentId === null || (typeof row.kitComponentId === "string" && UUID_PATTERN.test(row.kitComponentId)))
      && isConditionStatus(row.conditionStatus) && (row.notes === null || typeof row.notes === "string") && isDateString(row.recordedAt));
}
export function isOwnReturnProblem(value: unknown): value is OwnReturnProblem {
  return isRecord(value) && typeof value.loanId === "string" && UUID_PATTERN.test(value.loanId)
    && typeof value.itemId === "string" && UUID_PATTERN.test(value.itemId) && isDateString(value.returnedAt)
    && Array.isArray(value.problems) && value.problems.length > 0 && value.problems.every(row => isRecord(row)
      && (row.componentId === null || (typeof row.componentId === "string" && UUID_PATTERN.test(row.componentId)))
      && typeof row.kind === "string" && ["missing", "new_damage"].includes(row.kind) && (row.notes === null || typeof row.notes === "string"));
}
export function isStudentReturnProblem(value: unknown): value is StudentReturnProblem {
  return isOwnReturnProblem(value) && typeof (value as StudentReturnProblem).itemName === "string"
    && value.problems.every(row => typeof (row as { label?: unknown }).label === "string");
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
  return validLoan && (value.returnHistory === undefined || (isReturnHistory(value.returnHistory)
    && value.returnHistory.returnedAt === loan.returned_at
    && value.returnHistory.isLate === (Date.parse(value.returnHistory.returnedAt) > Date.parse(loan.due_date as string)))) && value.pickupConditions.every(condition => {
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
