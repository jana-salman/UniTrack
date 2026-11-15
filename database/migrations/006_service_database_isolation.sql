-- Shared-database microservice isolation. Review and apply separately after 005.
-- Creates group roles only: login roles/passwords and membership are provisioned
-- by the database owner outside source control. No service should use postgres or
-- Supabase service_role as its runtime DATABASE_URL identity.
BEGIN;

DO $$
DECLARE
  role_name text;
  role_record record;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'unitrack_users_service',
    'unitrack_equipment_service',
    'unitrack_loans_service'
  ] LOOP
    SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    INTO role_record
    FROM pg_roles
    WHERE rolname = role_name;

    IF NOT FOUND THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        role_name
      );
    ELSIF role_record.rolcanlogin
       OR role_record.rolsuper
       OR role_record.rolcreatedb
       OR role_record.rolcreaterole
       OR role_record.rolreplication
       OR role_record.rolbypassrls THEN
      RAISE EXCEPTION 'Existing role % has unsafe attributes; stop for owner review', role_name;
    END IF;
  END LOOP;
END;
$$;

GRANT USAGE ON SCHEMA public TO
  unitrack_users_service,
  unitrack_equipment_service,
  unitrack_loans_service;

-- The browser and Web gateway have no direct table access. Runtime service
-- roles receive only the operations used by the current extracted services.
-- Keep these revokes scoped to UniTrack objects so an unrelated object in the
-- shared public schema cannot be changed by this migration.
REVOKE ALL PRIVILEGES ON TABLE
  public.labs,
  public.equipment_categories,
  public.profiles,
  public.equipment_items,
  public.kits,
  public.kit_components,
  public.reservations,
  public.loans,
  public.condition_records,
  public.equipment_status_history
FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SEQUENCE
  public.labs_id_seq,
  public.equipment_categories_id_seq,
  public.equipment_status_history_id_seq
FROM PUBLIC;

-- Supabase creates these browser-facing roles. They are absent in plain local
-- PostgreSQL, so revoke them conditionally. UniTrack browser traffic goes
-- through Web; it does not query these tables through PostgREST.
DO $$
DECLARE
  browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.labs, public.equipment_categories, public.profiles, public.equipment_items, public.kits, public.kit_components, public.reservations, public.loans, public.condition_records, public.equipment_status_history FROM %I',
        browser_role
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON SEQUENCE public.labs_id_seq, public.equipment_categories_id_seq, public.equipment_status_history_id_seq FROM %I',
        browser_role
      );
    END IF;
  END LOOP;
END;
$$;

GRANT SELECT ON public.labs TO unitrack_users_service;
GRANT SELECT, UPDATE ON public.profiles TO unitrack_users_service;

GRANT SELECT, INSERT, UPDATE ON public.equipment_categories TO unitrack_equipment_service;
GRANT SELECT, INSERT, UPDATE ON public.equipment_items TO unitrack_equipment_service;
GRANT SELECT ON public.kits, public.kit_components TO unitrack_equipment_service;
GRANT SELECT, INSERT ON public.equipment_status_history TO unitrack_equipment_service;
GRANT USAGE, SELECT ON SEQUENCE
  public.equipment_categories_id_seq,
  public.equipment_status_history_id_seq
TO unitrack_equipment_service;

GRANT SELECT, UPDATE ON public.loans TO unitrack_loans_service;
GRANT SELECT ON public.reservations TO unitrack_loans_service;
GRANT SELECT, INSERT ON public.condition_records TO unitrack_loans_service;

DO $$
DECLARE
  policy_record record;
  using_clause text;
  check_clause text;
BEGIN
  FOR policy_record IN
    SELECT *
    FROM (VALUES
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
    ) AS policies(role_name, table_name, command_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = policy_record.table_name
        AND policyname = format(
          '%s_%s_%s',
          policy_record.role_name,
          policy_record.table_name,
          lower(policy_record.command_name)
        )
    ) THEN
      RAISE EXCEPTION 'Service isolation policy already exists; stop for owner review';
    END IF;

    using_clause := CASE
      WHEN policy_record.command_name IN ('SELECT', 'UPDATE', 'DELETE') THEN ' USING (true)'
      ELSE ''
    END;
    check_clause := CASE
      WHEN policy_record.command_name IN ('INSERT', 'UPDATE') THEN ' WITH CHECK (true)'
      ELSE ''
    END;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR %s TO %I%s%s',
      format(
        '%s_%s_%s',
        policy_record.role_name,
        policy_record.table_name,
        lower(policy_record.command_name)
      ),
      policy_record.table_name,
      policy_record.command_name,
      policy_record.role_name,
      using_clause,
      check_clause
    );
  END LOOP;
END;
$$;

COMMIT;
