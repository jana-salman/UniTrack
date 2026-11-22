-- S2-01: Reservation permissions for the Loans service.
-- Must run after migrations 006, S2-02, S2-09, 007, and S2-05.
-- Grants only the reservation operations required by the Loans service.

BEGIN;

-- Verify that migration 006 created the Loans service role.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'unitrack_loans_service'
  ) THEN
    RAISE EXCEPTION
      'S2-01 prerequisite missing: role unitrack_loans_service does not exist. Apply migration 006 first.';
  END IF;

  IF to_regclass('public.reservation_resources') IS NULL THEN
    RAISE EXCEPTION
      'S2-01 prerequisite missing: apply the S2-05 kit and reservation resource migration first.';
  END IF;
END;
$$;

-- Verify that S2-09 has already created its handover column
-- and its separately owned UPDATE policy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reservations'
      AND column_name = 'handover_operation'
  ) THEN
    RAISE EXCEPTION
      'S2-01 prerequisite missing: reservations.handover_operation does not exist. Apply S2-09 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reservations'
      AND policyname = 'c430prjct_40_reservations_handover_update'
  ) THEN
    RAISE EXCEPTION
      'S2-01 prerequisite missing: S2-09 handover UPDATE policy does not exist.';
  END IF;
END;
$$;

-- Allow the Loans service to create reservations using only
-- the columns required by the reservation workflow.
GRANT INSERT (
  item_id,
  borrower_id,
  lab_id,
  start_at,
  end_at,
  status
)
ON public.reservations
TO unitrack_loans_service;

-- Allow the Loans service to change reservation status only.
-- S2-09 separately owns the handover_operation permission.
GRANT UPDATE (status)
ON public.reservations
TO unitrack_loans_service;

-- S2-01 owns this INSERT policy.
-- Recreate it deterministically so that only confirmed reservations
-- can be inserted by the Loans service.
DROP POLICY IF EXISTS unitrack_loans_service_reservations_insert
ON public.reservations;

CREATE POLICY unitrack_loans_service_reservations_insert
ON public.reservations
FOR INSERT
TO unitrack_loans_service
WITH CHECK (status = 'confirmed');

COMMIT;
