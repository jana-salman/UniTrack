
import "server-only";

import { getDatabasePool } from "../db";

export type PickupEligibility =
  | "upcoming"
  | "eligible"
  | "expired";

export type PickupReservation = {
  id: string;
  startAt: string;
  endAt: string;
  eligibility: PickupEligibility;
};

export type ActivePickupLoan = {
  id: string;
  dueDate: string;
};

export type PickupMatch = {
  activeLoan: ActivePickupLoan | null;
  confirmedReservations: PickupReservation[];
  multipleEligibleReservations: boolean;
  canHandover: boolean;
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

export function getPickupEligibility(
  startAt: Date,
  endAt: Date,
  now: Date,
): PickupEligibility {
  if (now.getTime() < startAt.getTime()) {
    return "upcoming";
  }

  if (now.getTime() >= endAt.getTime()) {
    return "expired";
  }

  return "eligible";
}

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

  const now = new Date();

  const activeLoan = loanResult.rows[0]
    ? {
        id: loanResult.rows[0].id,
        dueDate: loanResult.rows[0].due_date.toISOString(),
      }
    : null;

  const confirmedReservations: PickupReservation[] =
    reservationResult.rows.map((reservation) => ({
      id: reservation.id,
      startAt: reservation.start_at.toISOString(),
      endAt: reservation.end_at.toISOString(),
      eligibility: getPickupEligibility(
        reservation.start_at,
        reservation.end_at,
        now,
      ),
    }));

  const eligibleReservations = confirmedReservations.filter(
    (reservation) => reservation.eligibility === "eligible",
  );

  const multipleEligibleReservations =
    eligibleReservations.length > 1;

  const canHandover =
    activeLoan === null &&
    eligibleReservations.length === 1;

  return {
    activeLoan,
    confirmedReservations,
    multipleEligibleReservations,
    canHandover,
  };
}
