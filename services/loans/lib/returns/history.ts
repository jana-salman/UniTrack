import "server-only";
import type { OwnReturnProblem, PickupCondition, RecordedReturnCondition, ReturnHistory, ReturnProblemCondition } from "@unitrack/contracts";
import { getDatabasePool } from "../db";
import { NEW_DAMAGE_NOTE } from "./inspection";

// Existing return writes persist an explicit additional-damage flag in this
// generated note prefix. Do not infer past damage from today's Equipment state.
interface ConditionRow {
  id: string; loan_id: string; kit_component_id: string | null;
  phase: "pickup" | "return"; condition_status: PickupCondition["condition_status"];
  notes: string | null; recorded_at: Date;
}
function recorded(row: ConditionRow): RecordedReturnCondition {
  return { id: row.id, kitComponentId: row.kit_component_id, conditionStatus: row.condition_status, notes: row.notes, recordedAt: row.recorded_at.toISOString() };
}
export function compareReturnProblems(pickup: Pick<ConditionRow, "kit_component_id" | "condition_status">[], returned: Pick<ConditionRow, "kit_component_id" | "condition_status" | "notes">[]): ReturnProblemCondition[] {
  return returned.flatMap(row => {
    const explicit = row.notes === NEW_DAMAGE_NOTE || row.notes?.startsWith(NEW_DAMAGE_NOTE + "\n") === true;
    const original = pickup.find(p => p.kit_component_id === row.kit_component_id);
    // Without a Good pickup baseline, damage may already have existed. An
    // explicit additional-damage report remains sufficient on any baseline.
    const kind: ReturnProblemCondition["kind"] | null = row.condition_status === "missing" ? "missing" : explicit || (row.condition_status === "damaged" && original?.condition_status === "good") ? "new_damage" : null;
    if (!kind) return [];
    const notes = explicit ? row.notes!.slice(NEW_DAMAGE_NOTE.length).trim() || null : row.notes;
    return [{ componentId: row.kit_component_id, kind, notes }];
  });
}
export async function getReturnHistory(loanId: string, itemId: string, labId: number, returnedAt: Date, dueDate: Date): Promise<ReturnHistory> {
  const result = await getDatabasePool().query<ConditionRow>(
    "select id, kit_component_id, condition_status, notes, recorded_at from public.condition_records where loan_id = $1 and item_id = $2 and lab_id = $3 and phase = 'return' order by recorded_at, id", [loanId, itemId, labId]);
  return { returnedAt: returnedAt.toISOString(), isLate: returnedAt.getTime() > dueDate.getTime(), conditions: result.rows.map(recorded) };
}
export async function getOwnReturnProblems(borrowerId: string, labId: number): Promise<OwnReturnProblem[]> {
  const pool = getDatabasePool();
  const loans = await pool.query<{ id: string; item_id: string; returned_at: Date }>(
    "select id, item_id, returned_at from public.loans where borrower_id = $1 and lab_id = $2 and returned_at is not null order by returned_at desc, id", [borrowerId, labId]);
  if (!loans.rows.length) return [];
  const conditions = await pool.query<ConditionRow>(
    "select c.id, c.loan_id, c.item_id, c.kit_component_id, c.phase, c.condition_status, c.notes, c.recorded_at from public.condition_records c join public.loans l on l.id = c.loan_id and l.item_id = c.item_id and l.lab_id = c.lab_id where l.borrower_id = $1 and l.lab_id = $2 and l.returned_at is not null and l.id = any($3::uuid[]) and c.phase in ('pickup', 'return') order by c.recorded_at, c.id", [borrowerId, labId, loans.rows.map(loan => loan.id)]);
  return loans.rows.flatMap(loan => {
    const rows = conditions.rows.filter(row => row.loan_id === loan.id);
    const problems = compareReturnProblems(rows.filter(row => row.phase === "pickup"), rows.filter(row => row.phase === "return"));
    return problems.length ? [{ loanId: loan.id, itemId: loan.item_id, returnedAt: loan.returned_at.toISOString(), problems }] : [];
  });
}
