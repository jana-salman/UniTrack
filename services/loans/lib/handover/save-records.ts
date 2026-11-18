import "server-only";
import type { PoolClient } from "pg";
import type { HandoverConditionInput, HandoverOutcome } from "@unitrack/contracts";

/**
 * Creates the loan and every pickup condition record in the caller's local
 * transaction. Runs only AFTER Equipment confirmed checkout. Loans are inserted
 * once and never updated by handover; condition records are insert-only.
 */
export async function saveHandoverRecordsInTransaction(
  client: PoolClient,
  result: HandoverOutcome,
  labId: number,
  conditions: HandoverConditionInput[],
  recordedBy: string,
  idVerifiedBy: string,
): Promise<void> {
  const loan = await client.query(
    `insert into public.loans
     (id, item_id, borrower_id, reservation_id, lab_id, borrowed_at, due_date, student_confirmed_at,
      university_id_verified_at, university_id_verified_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [result.loanId, result.itemId, result.borrowerId, result.reservationId, labId, result.borrowedAt, result.dueDate, result.studentConfirmedAt,
      result.universityIdVerifiedAt, idVerifiedBy],
  );
  if (loan.rows.length !== 1) throw new Error("The loan was not created.");

  for (const row of conditions) {
    await client.query(
      `insert into public.condition_records
       (loan_id, item_id, kit_component_id, lab_id, phase, condition_status, notes, recorded_by, recorded_at)
       values ($1, $2, $3, $4, 'pickup', $5, $6, $7, $8)`,
      [result.loanId, result.itemId, row.kitComponentId, labId, row.conditionStatus, row.notes || null, recordedBy, result.borrowedAt],
    );
  }
}
