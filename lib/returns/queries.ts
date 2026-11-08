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