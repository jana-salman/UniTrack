-- Disposable local verification for C430PRJCT-40 / S2-09 (run after 006 + S2-09).
DO $$
BEGIN
  IF (SELECT data_type || '/' || is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = 'student_confirmed_at')
     IS DISTINCT FROM 'timestamp with time zone/YES' THEN
    RAISE EXCEPTION 'S2-09 verification failed: loans.student_confirmed_at must be nullable timestamptz';
  END IF;
  IF (SELECT data_type || '/' || is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'handover_operation')
     IS DISTINCT FROM 'jsonb/YES' THEN
    RAISE EXCEPTION 'S2-09 verification failed: reservations.handover_operation must be nullable jsonb';
  END IF;

  IF EXISTS (SELECT 1 FROM public.loans WHERE student_confirmed_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.reservations WHERE handover_operation IS NOT NULL) THEN
    RAISE EXCEPTION 'S2-09 verification failed: existing rows were backfilled';
  END IF;

  -- Column-level least privilege for Loans.
  IF NOT has_column_privilege('unitrack_loans_service', 'public.loans', 'student_confirmed_at', 'INSERT')
     OR NOT has_column_privilege('unitrack_loans_service', 'public.loans', 'reservation_id', 'INSERT')
     OR has_column_privilege('unitrack_loans_service', 'public.loans', 'returned_at', 'INSERT')
     OR has_column_privilege('unitrack_loans_service', 'public.loans', 'return_operation', 'INSERT')
     OR has_table_privilege('unitrack_loans_service', 'public.loans', 'INSERT')
     OR NOT has_column_privilege('unitrack_loans_service', 'public.reservations', 'handover_operation', 'UPDATE')
     OR has_column_privilege('unitrack_loans_service', 'public.reservations', 'status', 'UPDATE')
     OR has_table_privilege('unitrack_loans_service', 'public.reservations', 'INSERT,DELETE')
     OR has_table_privilege('unitrack_loans_service', 'public.condition_records', 'UPDATE,DELETE')
     OR has_table_privilege('unitrack_loans_service', 'public.loans', 'DELETE') THEN
    RAISE EXCEPTION 'S2-09 verification failed: Loans column grants do not match the reviewed matrix';
  END IF;

  IF has_any_column_privilege('unitrack_equipment_service', 'public.loans', 'SELECT')
     OR has_any_column_privilege('unitrack_users_service', 'public.reservations', 'SELECT')
     OR has_any_column_privilege('unitrack_equipment_service', 'public.reservations', 'UPDATE') THEN
    RAISE EXCEPTION 'S2-09 verification failed: another service can access Loans tables';
  END IF;

  -- 006's reviewed table-level matrix and policy pattern are unchanged.
  IF (SELECT count(*) FROM information_schema.role_table_grants
      WHERE grantee IN ('unitrack_users_service', 'unitrack_equipment_service', 'unitrack_loans_service')
        AND table_schema = 'public') <> 18
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
         AND policyname LIKE 'unitrack\_%\_service\_%' ESCAPE '\') <> 18 THEN
    RAISE EXCEPTION 'S2-09 verification failed: 006 table grants or policies changed';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'loans'
                 AND policyname = 'c430prjct_40_loans_handover_insert' AND cmd = 'INSERT'
                 AND roles = ARRAY['unitrack_loans_service']::name[])
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reservations'
                 AND policyname = 'c430prjct_40_reservations_handover_update' AND cmd = 'UPDATE'
                 AND roles = ARRAY['unitrack_loans_service']::name[]) THEN
    RAISE EXCEPTION 'S2-09 verification failed: handover policies are missing';
  END IF;

  -- Custody protections remain installed and enabled.
  IF (SELECT count(*) FROM pg_trigger
      WHERE tgname IN ('loans_prevent_delete', 'condition_records_prevent_delete', 'equipment_status_history_immutable')
        AND tgenabled <> 'D' AND NOT tgisinternal) <> 3 THEN
    RAISE EXCEPTION 'S2-09 verification failed: custody/history protection triggers changed';
  END IF;
END;
$$;

-- Behavioral checks as the restricted Loans group (rolled back).
BEGIN;
SET LOCAL ROLE unitrack_loans_service;
UPDATE public.reservations SET handover_operation = handover_operation WHERE false;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.loans (item_id, borrower_id, lab_id, due_date, returned_at)
    VALUES ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 7001, now() + interval '1 day', now());
    RAISE EXCEPTION 'S2-09 verification failed: Loans inserted an already-returned loan';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    -- RLS: a service-created loan must carry student confirmation.
    INSERT INTO public.loans (item_id, borrower_id, lab_id, due_date)
    VALUES ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 7001, now() + interval '1 day');
    RAISE EXCEPTION 'S2-09 verification failed: Loans inserted an unconfirmed loan';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.reservations SET status = 'fulfilled' WHERE false;
    RAISE EXCEPTION 'S2-09 verification failed: Loans may update reservation status';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.condition_records SET notes = notes WHERE false;
    RAISE EXCEPTION 'S2-09 verification failed: Loans may update condition records';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
ROLLBACK;

SELECT 'PASS: C430PRJCT-40 handover columns, column grants, RLS and custody protections' AS result;
