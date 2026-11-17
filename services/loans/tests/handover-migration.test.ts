// Static shape checks for the C430PRJCT-40 / S2-09 migration (SQL text only;
// database/local-test/run.ps1 executes it on disposable PostgreSQL).
import { expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const migrations = fileURLToPath(new URL("../../../database/migrations/", import.meta.url));
const file = "C430PRJCT-40_S2-09_handover_confirmation.sql";
const sql = readFileSync(path.join(migrations, file), "utf8").replace(/--[^\n]*/g, "");

it("is the single S2-09 migration and is additive for existing rows", () => {
  expect(readdirSync(migrations).filter(name => /S2-09|C430PRJCT-40/i.test(name))).toEqual([file]);
  expect(sql).toMatch(/ALTER TABLE public\.loans ADD COLUMN IF NOT EXISTS student_confirmed_at TIMESTAMPTZ;/);
  expect(sql).toMatch(/ALTER TABLE public\.reservations ADD COLUMN IF NOT EXISTS handover_operation JSONB;/);
  // No rename/removal, backfill, data rewrite, trigger disabling or NOT NULL tightening.
  expect(sql).not.toMatch(/\b(?:DROP|RENAME|DELETE|TRUNCATE|DISABLE|DEFAULT|REVOKE)\b/i);
  expect(sql).not.toMatch(/ADD COLUMN[^;]*NOT NULL|SET NOT NULL/i);
  expect(sql).not.toMatch(/\bUPDATE\s+public\./i);
  expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
});

it("grants Loans only the handover columns, never table-wide or to other services", () => {
  expect(sql).toMatch(/GRANT INSERT \(\s*id, item_id, borrower_id, reservation_id, lab_id,\s*borrowed_at, due_date, student_confirmed_at\s*\) ON public\.loans TO unitrack_loans_service;/);
  expect(sql).toMatch(/GRANT UPDATE \(handover_operation\) ON public\.reservations TO unitrack_loans_service;/);
  expect(sql).not.toMatch(/returned_at,|return_operation,|GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)\s+ON\b/i);
  expect(sql).not.toMatch(/unitrack_(?:users|equipment)_service/);
  // Policy names must not match 006's exact 18-policy postflight pattern.
  for (const [, name] of sql.matchAll(/CREATE POLICY (\w+)/g)) expect(name).not.toMatch(/^unitrack_.*_service_/);
  expect(sql).toMatch(/WITH CHECK \(student_confirmed_at IS NOT NULL AND returned_at IS NULL\)/);
});

it("makes the student confirmation immutable without blocking Return's loan updates", () => {
  expect(sql).toMatch(/CREATE OR REPLACE TRIGGER loans_student_confirmation_immutable\s+BEFORE UPDATE OF student_confirmed_at ON public\.loans/);
  expect(sql).toMatch(/IF NEW\.student_confirmed_at IS DISTINCT FROM OLD\.student_confirmed_at THEN/);
  // Only the confirmation column is guarded; returned_at/return_operation stay updatable.
  expect(sql).not.toMatch(/BEFORE UPDATE ON public\.loans|returned_at IS DISTINCT|return_operation IS DISTINCT/);
});
