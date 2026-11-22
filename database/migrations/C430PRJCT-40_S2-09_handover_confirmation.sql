-- C430PRJCT-40 / S2-09 handover: student confirmation, assistant university-ID
-- check and recoverable pickup.
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
--   * loans.university_id_verified_at / university_id_verified_by record that
--     the lab assistant physically checked the student's university ID (PO
--     decision via JS). Only who and when: no ID number, upload or photo.
--     Both NULL or both set; existing loans keep NULL; nothing is backfilled.
--   * A trigger makes the confirmation and ID-check columns immutable after insert.
--
-- Amended in place before any shared application (it exists only on the
-- unmerged S2-09 branch). Re-running it upgrades any earlier local copy: the
-- columns/constraint are added if missing and the insert policy is altered.
--
-- Idempotent. If 006 is applied AFTER this file, run this file again: 006
-- revokes all table privileges, which also removes these column grants.
BEGIN;

ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS student_confirmed_at TIMESTAMPTZ;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS handover_operation JSONB;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS university_id_verified_at TIMESTAMPTZ;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS university_id_verified_by UUID
  REFERENCES public.profiles(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.loans'::regclass AND conname = 'loans_university_id_verification_pair'
  ) THEN
    ALTER TABLE public.loans ADD CONSTRAINT loans_university_id_verification_pair
      CHECK ((university_id_verified_at IS NULL) = (university_id_verified_by IS NULL));
  END IF;
END;
$$;

-- Custody protection: the student's confirmation and the assistant's ID check
-- are evidence and are fixed once the loan is inserted. 006 grants Loans
-- table-level UPDATE on loans (Return needs returned_at/return_operation), so
-- without this trigger a later update could add, change or clear them. Other
-- columns are unaffected. (Names kept from the first version for re-runs.)
CREATE OR REPLACE FUNCTION public.protect_loan_student_confirmation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.student_confirmed_at IS DISTINCT FROM OLD.student_confirmed_at THEN
    RAISE EXCEPTION 'loans.student_confirmed_at cannot be changed after the loan is created';
  END IF;
  IF NEW.university_id_verified_at IS DISTINCT FROM OLD.university_id_verified_at
     OR NEW.university_id_verified_by IS DISTINCT FROM OLD.university_id_verified_by THEN
    RAISE EXCEPTION 'loans university ID verification cannot be changed after the loan is created';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER loans_student_confirmation_immutable
BEFORE UPDATE OF student_confirmed_at, university_id_verified_at, university_id_verified_by ON public.loans
FOR EACH ROW EXECUTE FUNCTION public.protect_loan_student_confirmation();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unitrack_loans_service') THEN
    RAISE NOTICE 'unitrack_loans_service does not exist yet; columns added, grants skipped. Re-run after 006.';
    RETURN;
  END IF;

  GRANT INSERT (
    id, item_id, borrower_id, reservation_id, lab_id,
    borrowed_at, due_date, student_confirmed_at,
    university_id_verified_at, university_id_verified_by
  ) ON public.loans TO unitrack_loans_service;
  GRANT UPDATE (handover_operation) ON public.reservations TO unitrack_loans_service;

  -- These policies are this card's own additions, separate from 006's reviewed
  -- unitrack_<service>_service_* matrix (which they leave unchanged). They are
  -- verified explicitly by database/local-test/verify_C430PRJCT-40.sql (name,
  -- table, command, role; 006's 18 grants/policies unchanged) and by the
  -- restricted-role PostgreSQL handover tests (insert rule refused with 42501).
  -- Defense in depth: a service-created loan must carry the student's
  -- confirmation AND the assistant's university-ID check, and cannot be created
  -- already returned. An existing earlier copy of this policy is upgraded in
  -- place with ALTER POLICY (same name, role and command; nothing dropped).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'loans'
      AND policyname = 'c430prjct_40_loans_handover_insert'
  ) THEN
    CREATE POLICY c430prjct_40_loans_handover_insert ON public.loans
      FOR INSERT TO unitrack_loans_service
      WITH CHECK (student_confirmed_at IS NOT NULL AND returned_at IS NULL);
  END IF;
  ALTER POLICY c430prjct_40_loans_handover_insert ON public.loans
    WITH CHECK (
      student_confirmed_at IS NOT NULL
      AND university_id_verified_at IS NOT NULL
      AND university_id_verified_by IS NOT NULL
      AND returned_at IS NULL
    );

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
