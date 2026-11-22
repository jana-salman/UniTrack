-- DISPOSABLE LOCAL DATABASE ONLY (never Supabase). Run after 006 and C430PRJCT-40.
-- Creates one LOGIN account per service that only inherits that service's 006
-- group role, so manual testing goes through the same grants and RLS as
-- production instead of the container superuser. Synthetic local password.
\set ON_ERROR_STOP on
DO $$
DECLARE
  pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['unitrack_users_local', 'unitrack_users_service'],
    ['unitrack_equipment_local', 'unitrack_equipment_service'],
    ['unitrack_loans_local', 'unitrack_loans_service']
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = pair[2]) THEN
      RAISE EXCEPTION 'Group role % is missing; apply migration 006 first', pair[2];
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = pair[1]) THEN
      EXECUTE format(
        'CREATE ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L IN ROLE %I',
        pair[1], 'local_test_only', pair[2]);
    END IF;
  END LOOP;

  -- Prove the logins are isolated exactly like their groups.
  IF has_table_privilege('unitrack_loans_local', 'public.profiles', 'SELECT')
     OR has_table_privilege('unitrack_loans_local', 'public.equipment_items', 'SELECT')
     OR has_table_privilege('unitrack_equipment_local', 'public.loans', 'SELECT')
     OR has_table_privilege('unitrack_users_local', 'public.reservations', 'SELECT')
     OR NOT has_table_privilege('unitrack_loans_local', 'public.loans', 'SELECT')
     OR NOT has_column_privilege('unitrack_loans_local', 'public.loans', 'student_confirmed_at', 'INSERT')
     OR (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = 'unitrack_loans_local') THEN
    RAISE EXCEPTION 'Local service logins are not isolated as expected';
  END IF;
END;
$$;
SELECT 'PASS: restricted local service logins ready' AS result;
