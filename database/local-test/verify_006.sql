DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'unitrack_users_service',
    'unitrack_equipment_service',
    'unitrack_loans_service'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = role_name
        AND NOT rolcanlogin
        AND NOT rolsuper
        AND NOT rolcreatedb
        AND NOT rolcreaterole
        AND NOT rolreplication
        AND NOT rolbypassrls
    ) THEN
      RAISE EXCEPTION '006 verification failed: role % is missing or unsafe', role_name;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND policyname LIKE 'unitrack\_%\_service\_%' ESCAPE '\') <> 18 THEN
    RAISE EXCEPTION '006 verification failed: expected 18 service RLS policies';
  END IF;

  IF has_table_privilege('unitrack_users_service', 'public.equipment_items', 'SELECT')
     OR has_table_privilege('unitrack_equipment_service', 'public.loans', 'SELECT')
     OR has_table_privilege('unitrack_loans_service', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION '006 verification failed: a service can read another service table';
  END IF;

  IF NOT has_table_privilege('unitrack_users_service', 'public.profiles', 'SELECT,UPDATE')
     OR NOT has_table_privilege('unitrack_equipment_service', 'public.equipment_items', 'SELECT,INSERT,UPDATE')
     OR NOT has_table_privilege('unitrack_loans_service', 'public.loans', 'SELECT,UPDATE') THEN
    RAISE EXCEPTION '006 verification failed: an owned-table grant is missing';
  END IF;

  IF has_table_privilege('anon', 'public.profiles', 'SELECT,INSERT,UPDATE')
     OR has_table_privilege('authenticated', 'public.equipment_items', 'SELECT,INSERT,UPDATE')
     OR has_sequence_privilege('anon', 'public.labs_id_seq', 'USAGE,SELECT')
     OR has_sequence_privilege('authenticated', 'public.equipment_status_history_id_seq', 'USAGE,SELECT') THEN
    RAISE EXCEPTION '006 verification failed: a browser-facing role retains direct access';
  END IF;
END;
$$;

BEGIN;
SET LOCAL ROLE unitrack_users_service;
SELECT id, role, lab_id FROM public.profiles ORDER BY id;
UPDATE public.profiles SET role = role WHERE false;
ROLLBACK;

BEGIN;
SET LOCAL ROLE unitrack_equipment_service;
SELECT id, status FROM public.equipment_items ORDER BY id;
INSERT INTO public.equipment_categories (name, description)
VALUES ('Disposable Role Check', 'Rolled back after privilege/RLS verification');
ROLLBACK;

BEGIN;
SET LOCAL ROLE unitrack_loans_service;
SELECT id, returned_at FROM public.loans ORDER BY id;
UPDATE public.loans SET return_operation = return_operation WHERE false;
INSERT INTO public.condition_records
  (id, loan_id, item_id, lab_id, phase, condition_status, notes, recorded_by)
VALUES
  (
    '00000000-0000-4000-8000-000000000399',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000102',
    7001,
    'return',
    'good',
    'Rolled back role check',
    '00000000-0000-4000-8000-000000000001'
  );
ROLLBACK;

SELECT 'PASS: migration 006 service grants and RLS isolation' AS result;
