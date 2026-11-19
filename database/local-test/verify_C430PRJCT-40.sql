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

  IF (SELECT data_type || '/' || is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = 'university_id_verified_at')
     IS DISTINCT FROM 'timestamp with time zone/YES'
     OR (SELECT data_type || '/' || is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = 'university_id_verified_by')
     IS DISTINCT FROM 'uuid/YES' THEN
    RAISE EXCEPTION 'S2-09 verification failed: university ID check columns must be nullable timestamptz/uuid';
  END IF;
  -- Minimal evidence only: who and when. No ID number, upload or photo column.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'loans'
             AND column_name LIKE 'university\_id\_%' ESCAPE '\'
             AND column_name NOT IN ('university_id_verified_at', 'university_id_verified_by')) THEN
    RAISE EXCEPTION 'S2-09 verification failed: unexpected university ID data column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.loans'::regclass
                 AND conname = 'loans_university_id_verification_pair' AND contype = 'c' AND convalidated)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
                 WHERE c.conrelid = 'public.loans'::regclass AND c.contype = 'f'
                   AND c.confrelid = 'public.profiles'::regclass AND a.attname = 'university_id_verified_by'
                   AND c.confdeltype = 'r') THEN
    RAISE EXCEPTION 'S2-09 verification failed: university ID pair check or verifier foreign key missing';
  END IF;

  IF EXISTS (SELECT 1 FROM public.loans WHERE student_confirmed_at IS NOT NULL
             OR university_id_verified_at IS NOT NULL OR university_id_verified_by IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.reservations WHERE handover_operation IS NOT NULL) THEN
    RAISE EXCEPTION 'S2-09 verification failed: existing rows were backfilled';
  END IF;

  -- Column-level least privilege for Loans. Run right after the S2-09 migration:
  -- S2-09 itself grants NO reservation status update. Fulfilment's
  -- UPDATE (status) comes from LJ's S2-01 migration (in local tests, from the
  -- clearly marked SYNTHETIC_s2-01_reservation_status_grant.sql stand-in,
  -- applied only after this script).
  IF NOT has_column_privilege('unitrack_loans_service', 'public.loans', 'student_confirmed_at', 'INSERT')
     OR NOT has_column_privilege('unitrack_loans_service', 'public.loans', 'university_id_verified_at', 'INSERT')
     OR NOT has_column_privilege('unitrack_loans_service', 'public.loans', 'university_id_verified_by', 'INSERT')
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
    INSERT INTO public.loans (item_id, borrower_id, lab_id, due_date, university_id_verified_at, university_id_verified_by)
    VALUES ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 7001, now() + interval '1 day',
            now(), '00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'S2-09 verification failed: Loans inserted an unconfirmed loan';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    -- RLS: ... and the assistant's university-ID check (both fields).
    INSERT INTO public.loans (item_id, borrower_id, lab_id, due_date, student_confirmed_at)
    VALUES ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 7001, now() + interval '1 day', now());
    RAISE EXCEPTION 'S2-09 verification failed: Loans inserted a loan without the university ID check';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.loans (item_id, borrower_id, lab_id, due_date, student_confirmed_at, university_id_verified_at)
    VALUES ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 7001, now() + interval '1 day', now(), now());
    RAISE EXCEPTION 'S2-09 verification failed: Loans inserted a loan without the ID verifier';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
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

-- Confirmation immutability + Return compatibility, as the restricted Loans
-- group, on a synthetic loan that is rolled back.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'loans_student_confirmation_immutable'
                 AND tgrelid = 'public.loans'::regclass AND tgenabled <> 'D' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'S2-09 verification failed: confirmation immutability trigger missing or disabled';
  END IF;
END;
$$;
BEGIN;
SET LOCAL ROLE unitrack_loans_service;
INSERT INTO public.loans (id, item_id, borrower_id, lab_id, due_date, student_confirmed_at,
                          university_id_verified_at, university_id_verified_by)
VALUES ('00000000-0000-4000-8000-000000000498', '00000000-0000-4000-8000-000000000101',
        '00000000-0000-4000-8000-000000000002', 7001, now() + interval '1 day', now(),
        now(), '00000000-0000-4000-8000-000000000001');
-- The existing Return workflow's updates still work on a handover loan.
UPDATE public.loans SET return_operation = '{"state":"planned"}'::jsonb WHERE id = '00000000-0000-4000-8000-000000000498';
UPDATE public.loans SET returned_at = now() + interval '1 second' WHERE id = '00000000-0000-4000-8000-000000000498';
DO $$
BEGIN
  BEGIN
    UPDATE public.loans SET student_confirmed_at = NULL WHERE id = '00000000-0000-4000-8000-000000000498';
    RAISE EXCEPTION 'S2-09 verification failed: a student confirmation was cleared';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'loans.student_confirmed_at cannot be changed%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.loans SET student_confirmed_at = now() - interval '1 day' WHERE id = '00000000-0000-4000-8000-000000000498';
    RAISE EXCEPTION 'S2-09 verification failed: a student confirmation was rewritten';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'loans.student_confirmed_at cannot be changed%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.loans SET university_id_verified_at = now() - interval '1 day' WHERE id = '00000000-0000-4000-8000-000000000498';
    RAISE EXCEPTION 'S2-09 verification failed: a university ID check time was rewritten';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'loans university ID verification cannot be changed%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.loans SET university_id_verified_by = '00000000-0000-4000-8000-000000000002' WHERE id = '00000000-0000-4000-8000-000000000498';
    RAISE EXCEPTION 'S2-09 verification failed: a university ID verifier was rewritten';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'loans university ID verification cannot be changed%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.loans SET university_id_verified_at = NULL, university_id_verified_by = NULL WHERE id = '00000000-0000-4000-8000-000000000498';
    RAISE EXCEPTION 'S2-09 verification failed: a university ID check was cleared';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'loans university ID verification cannot be changed%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.loans SET university_id_verified_at = now(), university_id_verified_by = '00000000-0000-4000-8000-000000000001'
    WHERE id = '00000000-0000-4000-8000-000000000201';
    RAISE EXCEPTION 'S2-09 verification failed: a legacy loan gained a university ID check';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'loans university ID verification cannot be changed%' THEN RAISE; END IF;
  END;
  BEGIN
    -- A legacy (pre-S2-09) loan cannot gain a confirmation retroactively.
    UPDATE public.loans SET student_confirmed_at = now() WHERE id = '00000000-0000-4000-8000-000000000201';
    RAISE EXCEPTION 'S2-09 verification failed: a legacy loan gained a confirmation';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'loans.student_confirmed_at cannot be changed%' THEN RAISE; END IF;
  END;
END;
$$;
ROLLBACK;

-- The verification pair rule holds even for the table owner (rolled back).
BEGIN;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.loans (item_id, borrower_id, lab_id, due_date, university_id_verified_by)
    VALUES ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 7001, now() + interval '1 day',
            '00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'S2-09 verification failed: verifier saved without a verification time';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;
ROLLBACK;

SELECT 'PASS: C430PRJCT-40 handover columns, ID-check evidence, column grants, RLS and custody protections' AS result;
