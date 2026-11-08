import "server-only";

import type { PoolClient } from "pg";

import { getDatabasePool } from "@/lib/db";
import type { PickupCondition, ReturnLoan } from "./types";

export interface LockedReturn {
  client: PoolClient;
  loan: ReturnLoan;
  pickupConditions: PickupCondition[];
}

export class ReturnTransactionError extends Error {
  constructor(
    public readonly commitAttempted: boolean,
    public readonly originalError: unknown,
  ) {
    super(
      commitAttempted
        ? "The return could not be confirmed. Check its saved state before retrying."
        : "The return transaction failed.",
    );

    this.name = "ReturnTransactionError";
  }
}

export async function withReturnTransaction<T>(
  loanId: string,
  labId: number,
  operation: (context: LockedReturn) => Promise<T>,
): Promise<T> {
  const client = await getDatabasePool().connect();
  let commitAttempted = false;

  try {
    await client.query("BEGIN");

    const result = await client.query<ReturnLoan>(
      `select id, item_id, borrower_id, reservation_id,
              lab_id, borrowed_at, due_date, returned_at
       from public.loans
       where id = $1 and lab_id = $2
       for update`,
      [loanId, labId],
    );

    const loan = result.rows[0];

    if (!loan) {
      throw new Error("Loan not found.");
    }

    if (loan.returned_at !== null) {
      throw new Error("This loan has already been returned.");
    }

    const conditions = await client.query<PickupCondition>(
      `select id, kit_component_id, condition_status, notes
       from public.condition_records
       where loan_id = $1
         and item_id = $2
         and lab_id = $3
         and phase = 'pickup'
       order by recorded_at, id`,
      [loan.id, loan.item_id, labId],
    );

    const outcome = await operation({
      client,
      loan,
      pickupConditions: conditions.rows,
    });

    commitAttempted = true;
    await client.query("COMMIT");

    return outcome;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original failure.
    }

    throw new ReturnTransactionError(commitAttempted, error);
  } finally {
    client.release();
  }
}