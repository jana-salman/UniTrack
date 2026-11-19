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

/**
 * PO decision (JS/ZZ): a successful handover changes the reservation to
 * `fulfilled`. Runs in the SAME local transaction as
 * saveHandoverRecordsInTransaction, after the loan and every pickup record, so
 * fulfillment, loan and pickup records commit or roll back together. It also
 * stores the completed operation (the idempotent replay result) in the same
 * statement. Only a still-`confirmed` reservation with the planned item and
 * borrower is changed; anything else affects no row and the caller rolls the
 * whole transaction back. The confirmed dates are compared by the caller on
 * the row it holds FOR UPDATE in this same transaction (SQL equality against
 * JavaScript millisecond times would miss PostgreSQL's microseconds).
 *
 * Needs `UPDATE (status)` on public.reservations for the Loans role. That
 * grant belongs to LJ's S2-01 reservation-write migration, not to S2-09.
 */
export async function fulfilReservationInTransaction(
  client: PoolClient,
  result: HandoverOutcome,
  labId: number,
  completedOperation: unknown,
): Promise<void> {
  const updated = await client.query(
    `update public.reservations
     set status = 'fulfilled', handover_operation = $1::jsonb
     where id = $2 and lab_id = $3 and item_id = $4 and borrower_id = $5 and status = 'confirmed'
     returning id`,
    [JSON.stringify(completedOperation), result.reservationId, labId, result.itemId, result.borrowerId],
  );
  if (updated.rows.length !== 1) throw new Error("The reservation was not marked fulfilled.");
}
