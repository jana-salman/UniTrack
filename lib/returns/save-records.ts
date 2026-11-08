import "server-only";

import type { PoolClient } from "pg";

import type {
  ConfirmReturnInput,
  ReturnLoan,
} from "./types";

export async function saveReturnRecordsInTransaction(
  client: PoolClient,
  loan: ReturnLoan,
  input: ConfirmReturnInput,
  returnedAt: Date,
  recordedBy: string,
): Promise<void> {
  const result = await client.query(
    `update public.loans
     set returned_at = $1
     where id = $2
       and lab_id = $3
       and returned_at is null
     returning id`,
    [returnedAt, loan.id, loan.lab_id],
  );

  if (result.rows.length !== 1) {
    throw new Error("This loan has already been returned or is unavailable.");
  }

  for (const record of input.conditions) {
    const notes = [
      record.newDamage
        ? "New or additional damage reported at return."
        : null,
      record.notes?.trim() || null,
    ]
      .filter(Boolean)
      .join("\n");

    await client.query(
      `insert into public.condition_records
       (
         loan_id,
         item_id,
         kit_component_id,
         lab_id,
         phase,
         condition_status,
         notes,
         recorded_by,
         recorded_at
       )
       values ($1, $2, $3, $4, 'return', $5, $6, $7, $8)`,
      [
        loan.id,
        loan.item_id,
        record.kitComponentId,
        loan.lab_id,
        record.conditionStatus,
        notes || null,
        recordedBy,
        returnedAt,
      ],
    );
  }
}