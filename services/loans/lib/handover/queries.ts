import "server-only";
import type { HandoverDetails, HandoverPending, HandoverPendingState, InterruptedHandover, PickupCondition } from "@unitrack/contracts";
import { getDatabasePool } from "../db";

interface ReservationRow {
  id: string; item_id: string; borrower_id: string; lab_id: number;
  start_at: Date; end_at: Date; status: string;
  operation_state: string | null; operation_actor: string | null; operation_started: string | null;
}
const UNFINISHED: readonly string[] = ["planned", "applied", "compensating"];
/** Who may finish/undo: a confirmed checkout ('applied') needs no Equipment write. */
function recoverable(state: string, starter: string | null, actorId: string): boolean {
  return state === "applied" || starter === actorId;
}
interface LoanRow {
  id: string; item_id: string; borrowed_at: Date; due_date: Date;
  student_confirmed_at: Date | null; university_id_verified_at: Date | null; returned_at: Date | null;
}

/** Same-lab reservation plus its completed handover, if any. No operation internals. */
export async function getHandoverDetails(reservationId: string, labId: number, actorId: string): Promise<HandoverDetails | null> {
  const pool = getDatabasePool();
  const reservation = (await pool.query<ReservationRow>(
    `select id, item_id, borrower_id, lab_id, start_at, end_at, status,
            handover_operation ->> 'state' as operation_state,
            handover_operation ->> 'actor' as operation_actor,
            handover_operation -> 'result' ->> 'borrowedAt' as operation_started
     from public.reservations
     where id = $1 and lab_id = $2`,
    [reservationId, labId],
  )).rows[0];
  if (!reservation) return null;

  const loan = (await pool.query<LoanRow>(
    `select id, item_id, borrowed_at, due_date, student_confirmed_at, university_id_verified_at, returned_at
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
      universityIdVerifiedAt: loan.university_id_verified_at?.toISOString() ?? null,
      returnedAt: loan.returned_at?.toISOString() ?? null,
      pickupConditions: pickup.map(row => ({ id: row.id, kit_component_id: row.kit_component_id, condition_status: row.condition_status, notes: row.notes })),
    } : null,
    pending: !loan && reservation.operation_state && UNFINISHED.includes(reservation.operation_state) && reservation.operation_started
      ? {
        state: reservation.operation_state as HandoverPending["state"],
        startedAt: new Date(reservation.operation_started).toISOString(),
        recoverableByYou: recoverable(reservation.operation_state, reservation.operation_actor, actorId),
      }
      : null,
  };
}

/**
 * Unfinished handovers in the actor's lab, oldest first, so staff can find and
 * finish them without the original browser. No borrower or checklist data.
 */
export async function listInterruptedHandovers(labId: number, actorId: string): Promise<InterruptedHandover[]> {
  const rows = (await getDatabasePool().query<{ id: string; item_id: string; state: string; actor: string | null; started: string | null }>(
    `select id, item_id, handover_operation ->> 'state' as state, handover_operation ->> 'actor' as actor,
            handover_operation -> 'result' ->> 'borrowedAt' as started
     from public.reservations
     where lab_id = $1 and handover_operation ->> 'state' in ('planned', 'applied', 'compensating')
     order by started, id
     limit 100`,
    [labId],
  )).rows;
  return rows.filter(row => row.started).map(row => ({
    reservationId: row.id, itemId: row.item_id, state: row.state as HandoverPendingState,
    startedAt: new Date(row.started!).toISOString(), recoverableByYou: recoverable(row.state, row.actor, actorId),
  }));
}
