
import "server-only";

import { getDatabasePool } from "../db";

export type PickupReservation = {
  id: string;
  startAt: string;
  endAt: string;
};

export type ActivePickupLoan = {
  id: string;
  dueDate: string;
};

export type PickupMatch = {
  activeLoan: ActivePickupLoan | null;
  confirmedReservations: PickupReservation[];
};

type LoanRow = {
  id: string;
  due_date: Date;
};

type ReservationRow = {
  id: string;
  start_at: Date;
  end_at: Date;
};

export async function getPickupMatch(
  itemId: string,
  labId: number,
): Promise<PickupMatch> {
  const db = getDatabasePool();

  const loanResult = await db.query<LoanRow>(
    `SELECT id, due_date
     FROM public.loans
     WHERE item_id = $1
       AND lab_id = $2
       AND returned_at IS NULL`,
    [itemId, labId],
  );

  const reservationResult = await db.query<ReservationRow>(
    `SELECT id, start_at, end_at
     FROM public.reservations
     WHERE item_id = $1
       AND lab_id = $2
       AND status = 'confirmed'
     ORDER BY start_at ASC, id ASC`,
    [itemId, labId],
  );

  const activeLoan = loanResult.rows[0];

  return {
    activeLoan: activeLoan
      ? {
          id: activeLoan.id,
          dueDate: activeLoan.due_date.toISOString(),
        }
      : null,

    confirmedReservations: reservationResult.rows.map(
      (reservation) => ({
        id: reservation.id,
        startAt: reservation.start_at.toISOString(),
        endAt: reservation.end_at.toISOString(),
      }),
    ),
  };
}
