import "server-only";
import type { HandoverDetails, PickupCondition } from "@unitrack/contracts";
import { getDatabasePool } from "../db";

interface ReservationRow {
  id: string; item_id: string; borrower_id: string; lab_id: number;
  start_at: Date; end_at: Date; status: string; operation_state: string | null;
}
interface LoanRow {
  id: string; item_id: string; borrowed_at: Date; due_date: Date;
  student_confirmed_at: Date | null; returned_at: Date | null;
}

/** Same-lab reservation plus its completed handover, if any. No operation internals. */
export async function getHandoverDetails(reservationId: string, labId: number): Promise<HandoverDetails | null> {
  const pool = getDatabasePool();
  const reservation = (await pool.query<ReservationRow>(
    `select id, item_id, borrower_id, lab_id, start_at, end_at, status,
            handover_operation ->> 'state' as operation_state
     from public.reservations
     where id = $1 and lab_id = $2`,
    [reservationId, labId],
  )).rows[0];
  if (!reservation) return null;

  const loan = (await pool.query<LoanRow>(
    `select id, item_id, borrowed_at, due_date, student_confirmed_at, returned_at
     from public.loans
     where reservation_id = $1 and lab_id = $2`,
    [reservation.id, labId],
  )).rows[0];

  const pickup = loan ? (await pool.query<PickupCondition>(
    `select id, kit_component_id, condition_status, notes
     from public.condition_records
     where loan_id = $1 and item_id = $2 and lab_id = $3 and phase = 'pickup'
     order by recorded_at, id`,
    [loan.id, loan.item_id, labId],
  )).rows : [];

  return {
    reservation: {
      id: reservation.id, item_id: reservation.item_id, borrower_id: reservation.borrower_id,
      lab_id: reservation.lab_id, start_at: reservation.start_at.toISOString(),
      end_at: reservation.end_at.toISOString(), status: reservation.status,
    },
    handover: loan ? {
      loanId: loan.id, borrowedAt: loan.borrowed_at.toISOString(), dueDate: loan.due_date.toISOString(),
      studentConfirmedAt: loan.student_confirmed_at?.toISOString() ?? null,
      returnedAt: loan.returned_at?.toISOString() ?? null,
      pickupConditions: pickup.map(row => ({ id: row.id, kit_component_id: row.kit_component_id, condition_status: row.condition_status, notes: row.notes })),
    } : null,
    pendingOperation: !loan && reservation.operation_state !== null && reservation.operation_state !== "completed",
  };
}
