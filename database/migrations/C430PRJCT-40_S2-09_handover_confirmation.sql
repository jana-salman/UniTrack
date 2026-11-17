-- C430PRJCT-40 / S2-09 handover: student confirmation and recoverable pickup.
-- Review and apply separately AFTER 004 and 006. Never run at application startup.
--
-- Additive only:
--   * loans.student_confirmed_at records when the borrower confirmed on screen.
--     Existing loans keep NULL; nothing is backfilled.
--   * reservations.handover_operation is the durable Loans plan (stable
--     Equipment idempotency key, attempt, actor, accepted time) that must be
--     committed BEFORE Equipment is asked to check the item out. No loan or
--     condition record exists until checkout succeeds, so the plan cannot live
--     on the loan the way return_operation does.
--   * Column-level grants only. Loans may insert a loan with handover columns
--     (never returned_at/return_operation) and may update only the handover plan
--     column of a reservation. Table-level ACLs from 006 are unchanged.
--   * condition_records stays insert-only for Loans; loans/condition_records
--     delete triggers and immutable history are untouched.
--
-- Idempotent. If 006 is applied AFTER this file, run this file again: 006
-- revokes all table privileges, which also removes these column grants.
BEGIN;

ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS student_confirmed_at TIMESTAMPTZ;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS handover_operation JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unitrack_loans_service') THEN
    RAISE NOTICE 'unitrack_loans_service does not exist yet; columns added, grants skipped. Re-run after 006.';
    RETURN;
  END IF;

  GRANT INSERT (
    id, item_id, borrower_id, reservation_id, lab_id,
    borrowed_at, due_date, student_confirmed_at
  ) ON public.loans TO unitrack_loans_service;
  GRANT UPDATE (handover_operation) ON public.reservations TO unitrack_loans_service;

  -- Names deliberately avoid 006's unitrack_<service>_service_ policy pattern,
  -- so 006's exact 18-policy postflight remains valid.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'loans'
      AND policyname = 'c430prjct_40_loans_handover_insert'
  ) THEN
    -- Defense in depth: a service-created loan must carry student confirmation
    -- and cannot be created already returned.
    CREATE POLICY c430prjct_40_loans_handover_insert ON public.loans
      FOR INSERT TO unitrack_loans_service
      WITH CHECK (student_confirmed_at IS NOT NULL AND returned_at IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reservations'
      AND policyname = 'c430prjct_40_reservations_handover_update'
  ) THEN
    CREATE POLICY c430prjct_40_reservations_handover_update ON public.reservations
      FOR UPDATE TO unitrack_loans_service
      USING (true) WITH CHECK (true);
  END IF;
END;
$$;

COMMIT;
