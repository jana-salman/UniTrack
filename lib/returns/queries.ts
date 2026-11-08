import "server-only";

import { getDatabasePool } from "@/lib/db";
import type { PickupCondition, ReturnLoan } from "./types";

export async function getReturnDetails(
  loanId: string,
  labId: number,
): Promise<{
  loan: ReturnLoan;
  pickupConditions: PickupCondition[];
} | null> {
  const pool = getDatabasePool();

  const loanResult = await pool.query<ReturnLoan>(
    `select id, item_id, borrower_id, reservation_id,
            lab_id, borrowed_at, due_date, returned_at
     from public.loans
     where id = $1 and lab_id = $2`,
    [loanId, labId],
  );

  const loan = loanResult.rows[0];

  if (!loan) {
    return null;
  }

  const conditionResult = await pool.query<PickupCondition>(
    `select id, kit_component_id, condition_status, notes
     from public.condition_records
     where loan_id = $1
       and item_id = $2
       and lab_id = $3
       and phase = 'pickup'
     order by recorded_at, id`,
    [loan.id, loan.item_id, labId],
  );

  return {
    loan,
    pickupConditions: conditionResult.rows,
  };
}

export async function hasActivePickup(
  loan: ReturnLoan,
  returnedAt: Date,
): Promise<boolean> {
  const result = await getDatabasePool().query<{ exists: boolean }>(
    `select exists (
       select 1
       from public.reservations
       where item_id = $1
         and lab_id = $2
         and status = 'confirmed'
         and start_at <= $3
         and end_at > $3
         and id is distinct from $4::uuid
     ) as exists`,
    [
      loan.item_id,
      loan.lab_id,
      returnedAt,
      loan.reservation_id,
    ],
  );

  return result.rows[0].exists;
}