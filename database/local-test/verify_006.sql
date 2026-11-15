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

  IF NOT has_schema_privilege('unitrack_users_service', 'public', 'USAGE')
     OR NOT has_schema_privilege('unitrack_equipment_service', 'public', 'USAGE')
     OR NOT has_schema_privilege('unitrack_loans_service', 'public', 'USAGE')
     OR has_schema_privilege('unitrack_users_service', 'public', 'CREATE')
     OR has_schema_privilege('unitrack_equipment_service', 'public', 'CREATE')
     OR has_schema_privilege('unitrack_loans_service', 'public', 'CREATE') THEN
    RAISE EXCEPTION '006 verification failed: service schema privileges do not match USAGE-only access';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND policyname LIKE 'unitrack\_%\_service\_%' ESCAPE '\') <> 18 THEN
    RAISE EXCEPTION '006 verification failed: expected 18 service RLS policies';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership
    JOIN pg_roles AS member_role ON member_role.oid = membership.member
    WHERE member_role.rolname IN (
      'unitrack_users_service',
      'unitrack_equipment_service',
      'unitrack_loans_service'
    )
  ) THEN
    RAISE EXCEPTION '006 verification failed: a service group inherits another role';
  END IF;

  IF (
    SELECT count(*)
    FROM information_schema.role_table_grants
    WHERE grantee IN (
      'unitrack_users_service',
      'unitrack_equipment_service',
      'unitrack_loans_service'
    )
      AND table_schema = 'public'
  ) <> 18 THEN
    RAISE EXCEPTION '006 verification failed: unexpected service table grant count';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants AS actual
    WHERE actual.grantee IN (
      'unitrack_users_service',
      'unitrack_equipment_service',
      'unitrack_loans_service'
    )
      AND actual.table_schema = 'public'
      AND (actual.grantee, actual.table_name, actual.privilege_type) NOT IN (
        VALUES
          ('unitrack_users_service', 'labs', 'SELECT'),
          ('unitrack_users_service', 'profiles', 'SELECT'),
          ('unitrack_users_service', 'profiles', 'UPDATE'),
          ('unitrack_equipment_service', 'equipment_categories', 'SELECT'),
          ('unitrack_equipment_service', 'equipment_categories', 'INSERT'),
          ('unitrack_equipment_service', 'equipment_categories', 'UPDATE'),
          ('unitrack_equipment_service', 'equipment_items', 'SELECT'),
          ('unitrack_equipment_service', 'equipment_items', 'INSERT'),
          ('unitrack_equipment_service', 'equipment_items', 'UPDATE'),
          ('unitrack_equipment_service', 'kits', 'SELECT'),
          ('unitrack_equipment_service', 'kit_components', 'SELECT'),
          ('unitrack_equipment_service', 'equipment_status_history', 'SELECT'),
          ('unitrack_equipment_service', 'equipment_status_history', 'INSERT'),
          ('unitrack_loans_service', 'loans', 'SELECT'),
          ('unitrack_loans_service', 'loans', 'UPDATE'),
          ('unitrack_loans_service', 'reservations', 'SELECT'),
          ('unitrack_loans_service', 'condition_records', 'SELECT'),
          ('unitrack_loans_service', 'condition_records', 'INSERT')
      )
  ) THEN
    RAISE EXCEPTION '006 verification failed: an unexpected service table grant exists';
  END IF;

  IF (
    SELECT count(*)
    FROM information_schema.role_usage_grants
    WHERE grantee IN (
      'unitrack_users_service',
      'unitrack_equipment_service',
      'unitrack_loans_service'
    )
      AND object_schema = 'public'
      AND object_type = 'SEQUENCE'
  ) <> 2 THEN
    RAISE EXCEPTION '006 verification failed: unexpected service sequence USAGE grants';
  END IF;

  IF NOT has_sequence_privilege(
       'unitrack_equipment_service',
       'public.equipment_categories_id_seq',
       'USAGE,SELECT'
     )
     OR NOT has_sequence_privilege(
       'unitrack_equipment_service',
       'public.equipment_status_history_id_seq',
       'USAGE,SELECT'
     )
     OR has_sequence_privilege(
       'unitrack_equipment_service',
       'public.labs_id_seq',
       'USAGE,SELECT'
     )
     OR has_sequence_privilege(
       'unitrack_users_service',
       'public.equipment_categories_id_seq',
       'USAGE,SELECT'
     )
     OR has_sequence_privilege(
       'unitrack_loans_service',
       'public.equipment_status_history_id_seq',
       'USAGE,SELECT'
     ) THEN
    RAISE EXCEPTION '006 verification failed: service sequence grants do not match the reviewed matrix';
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
