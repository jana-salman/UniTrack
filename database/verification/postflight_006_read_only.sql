-- UniTrack migration 006: read-only postflight verification
--
-- Run as one query in Supabase SQL Editor after migration 006 and the three
-- runtime LOGIN roles/memberships have been provisioned. This query reads only
-- PostgreSQL catalogs and privilege functions. It performs no DDL/DML, SET ROLE,
-- sequence calls, trigger probes, or advisory locks.
--
-- Expected private runtime role names:
--   unitrack_users_runtime     -> unitrack_users_service
--   unitrack_equipment_runtime -> unitrack_equipment_service
--   unitrack_loans_runtime     -> unitrack_loans_service
--   unitrack_users_dev         -> unitrack_users_service
--   unitrack_equipment_dev     -> unitrack_equipment_service
--   unitrack_loans_dev         -> unitrack_loans_service

WITH
service_groups(role_name) AS (
  VALUES
    ('unitrack_users_service'),
    ('unitrack_equipment_service'),
    ('unitrack_loans_service')
),
runtime_roles(role_name, group_name) AS (
  VALUES
    ('unitrack_users_runtime', 'unitrack_users_service'),
    ('unitrack_equipment_runtime', 'unitrack_equipment_service'),
    ('unitrack_loans_runtime', 'unitrack_loans_service'),
    ('unitrack_users_dev', 'unitrack_users_service'),
    ('unitrack_equipment_dev', 'unitrack_equipment_service'),
    ('unitrack_loans_dev', 'unitrack_loans_service')
),
expected_group_memberships(
  member_name,
  group_name,
  grantor_name,
  admin_option,
  inherit_option,
  set_option
) AS (
  VALUES
    -- Explicit runtime-to-service memberships provisioned by the database
    -- owner. PostgreSQL 16+ records INHERIT/SET options independently.
    ('unitrack_users_runtime', 'unitrack_users_service', 'postgres', false, true, true),
    ('unitrack_equipment_runtime', 'unitrack_equipment_service', 'postgres', false, true, true),
    ('unitrack_loans_runtime', 'unitrack_loans_service', 'postgres', false, true, true),
    ('unitrack_users_dev', 'unitrack_users_service', 'postgres', false, true, true),
    ('unitrack_equipment_dev', 'unitrack_equipment_service', 'postgres', false, true, true),
    ('unitrack_loans_dev', 'unitrack_loans_service', 'postgres', false, true, true),
    -- Supabase grants its non-superuser postgres role administrative control
    -- of roles created through that account. These memberships confer neither
    -- inherited privileges nor SET ROLE capability.
    ('postgres', 'unitrack_users_service', 'supabase_admin', true, false, false),
    ('postgres', 'unitrack_equipment_service', 'supabase_admin', true, false, false),
    ('postgres', 'unitrack_loans_service', 'supabase_admin', true, false, false)
),
owned_tables(table_name, owner_group) AS (
  VALUES
    ('labs', 'unitrack_users_service'),
    ('profiles', 'unitrack_users_service'),
    ('equipment_categories', 'unitrack_equipment_service'),
    ('equipment_items', 'unitrack_equipment_service'),
    ('kits', 'unitrack_equipment_service'),
    ('kit_components', 'unitrack_equipment_service'),
    ('equipment_status_history', 'unitrack_equipment_service'),
    ('reservations', 'unitrack_loans_service'),
    ('loans', 'unitrack_loans_service'),
    ('condition_records', 'unitrack_loans_service')
),
expected_table_grants(role_name, table_name, privilege_type) AS (
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
),
expected_sequence_grants(role_name, sequence_name, privilege_type) AS (
  VALUES
    ('unitrack_equipment_service', 'equipment_categories_id_seq', 'USAGE'),
    ('unitrack_equipment_service', 'equipment_categories_id_seq', 'SELECT'),
    ('unitrack_equipment_service', 'equipment_status_history_id_seq', 'USAGE'),
    ('unitrack_equipment_service', 'equipment_status_history_id_seq', 'SELECT')
),
expected_policies(group_name, table_name, command_name, using_true, check_true) AS (
  VALUES
    ('unitrack_users_service', 'labs', 'SELECT', true, false),
    ('unitrack_users_service', 'profiles', 'SELECT', true, false),
    ('unitrack_users_service', 'profiles', 'UPDATE', true, true),
    ('unitrack_equipment_service', 'equipment_categories', 'SELECT', true, false),
    ('unitrack_equipment_service', 'equipment_categories', 'INSERT', false, true),
    ('unitrack_equipment_service', 'equipment_categories', 'UPDATE', true, true),
    ('unitrack_equipment_service', 'equipment_items', 'SELECT', true, false),
    ('unitrack_equipment_service', 'equipment_items', 'INSERT', false, true),
    ('unitrack_equipment_service', 'equipment_items', 'UPDATE', true, true),
    ('unitrack_equipment_service', 'kits', 'SELECT', true, false),
    ('unitrack_equipment_service', 'kit_components', 'SELECT', true, false),
    ('unitrack_equipment_service', 'equipment_status_history', 'SELECT', true, false),
    ('unitrack_equipment_service', 'equipment_status_history', 'INSERT', false, true),
    ('unitrack_loans_service', 'loans', 'SELECT', true, false),
    ('unitrack_loans_service', 'loans', 'UPDATE', true, true),
    ('unitrack_loans_service', 'reservations', 'SELECT', true, false),
    ('unitrack_loans_service', 'condition_records', 'SELECT', true, false),
    ('unitrack_loans_service', 'condition_records', 'INSERT', false, true)
),
actual_table_grants AS (
  SELECT
    grantee.rolname AS role_name,
    object.relname AS table_name,
    acl.privilege_type,
    acl.is_grantable
  FROM pg_class AS object
  JOIN pg_namespace AS namespace ON namespace.oid = object.relnamespace
  CROSS JOIN LATERAL aclexplode(
    COALESCE(object.relacl, acldefault('r', object.relowner))
  ) AS acl
  JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
  WHERE namespace.nspname = 'public'
    AND object.relkind IN ('r', 'p')
    AND object.relname IN (SELECT table_name FROM owned_tables)
    AND grantee.rolname IN (SELECT role_name FROM service_groups)
),
actual_sequence_grants AS (
  SELECT
    grantee.rolname AS role_name,
    object.relname AS sequence_name,
    acl.privilege_type,
    acl.is_grantable
  FROM pg_class AS object
  JOIN pg_namespace AS namespace ON namespace.oid = object.relnamespace
  CROSS JOIN LATERAL aclexplode(
    COALESCE(object.relacl, acldefault('S', object.relowner))
  ) AS acl
  JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
  WHERE namespace.nspname = 'public'
    AND object.relkind = 'S'
    AND object.relname IN (
      'labs_id_seq',
      'equipment_categories_id_seq',
      'equipment_status_history_id_seq'
    )
    AND grantee.rolname IN (SELECT role_name FROM service_groups)
),
checks AS (
  SELECT
    10 AS sort_order,
    'service_group_attributes'::text AS check_name,
    (SELECT count(*) FROM pg_roles
      WHERE rolname IN (SELECT role_name FROM service_groups)
        AND NOT rolcanlogin
        AND NOT rolsuper
        AND NOT rolcreatedb
        AND NOT rolcreaterole
        AND NOT rolreplication
        AND NOT rolbypassrls) = 3 AS passed,
    'Three safe NOLOGIN/NOBYPASSRLS service groups exist'::text AS expected

  UNION ALL
  SELECT
    20,
    'runtime_login_attributes',
    (SELECT count(*) FROM pg_roles
      WHERE rolname IN (SELECT role_name FROM runtime_roles)
        AND rolcanlogin
        AND rolinherit
        AND NOT rolsuper
        AND NOT rolcreatedb
        AND NOT rolcreaterole
        AND NOT rolreplication
        AND NOT rolbypassrls) = 6,
    'Six safe LOGIN/INHERIT/NOBYPASSRLS production and development runtime roles exist'

  UNION ALL
  SELECT
    30,
    'exact_role_memberships',
    NOT EXISTS (
      SELECT 1
      FROM runtime_roles AS expected_membership
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_auth_members AS membership
        JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
        JOIN pg_roles AS member_role ON member_role.oid = membership.member
        JOIN pg_roles AS grantor_role ON grantor_role.oid = membership.grantor
        WHERE granted_role.rolname = expected_membership.group_name
          AND member_role.rolname = expected_membership.role_name
          AND NOT membership.admin_option
          AND membership.inherit_option
          AND membership.set_option
          AND grantor_role.rolname = 'postgres'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_auth_members AS membership
      JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
      JOIN pg_roles AS member_role ON member_role.oid = membership.member
      WHERE member_role.rolname IN (SELECT role_name FROM runtime_roles)
        AND (member_role.rolname, granted_role.rolname) NOT IN (
          SELECT role_name, group_name FROM runtime_roles
        )
    )
    AND NOT EXISTS (
      (
        SELECT
          expected.member_name,
          expected.group_name,
          expected.grantor_name,
          expected.admin_option,
          expected.inherit_option,
          expected.set_option
        FROM expected_group_memberships AS expected
        EXCEPT
        SELECT
          member_role.rolname,
          granted_role.rolname,
          grantor_role.rolname,
          membership.admin_option,
          membership.inherit_option,
          membership.set_option
        FROM pg_auth_members AS membership
        JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
        JOIN pg_roles AS member_role ON member_role.oid = membership.member
        JOIN pg_roles AS grantor_role ON grantor_role.oid = membership.grantor
        WHERE granted_role.rolname IN (SELECT role_name FROM service_groups)
      )
      UNION ALL
      (
        SELECT
          member_role.rolname,
          granted_role.rolname,
          grantor_role.rolname,
          membership.admin_option,
          membership.inherit_option,
          membership.set_option
        FROM pg_auth_members AS membership
        JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
        JOIN pg_roles AS member_role ON member_role.oid = membership.member
        JOIN pg_roles AS grantor_role ON grantor_role.oid = membership.grantor
        WHERE granted_role.rolname IN (SELECT role_name FROM service_groups)
        EXCEPT
        SELECT
          expected.member_name,
          expected.group_name,
          expected.grantor_name,
          expected.admin_option,
          expected.inherit_option,
          expected.set_option
        FROM expected_group_memberships AS expected
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_auth_members AS membership
      JOIN pg_roles AS member_role ON member_role.oid = membership.member
      WHERE member_role.rolname IN (SELECT role_name FROM service_groups)
    ),
    'Exact runtime memberships plus non-inheriting/non-settable Supabase postgres administration; groups inherit nothing'

  UNION ALL
  SELECT
    40,
    'no_service_object_ownership',
    NOT EXISTS (
      SELECT 1
      FROM pg_class AS object
      JOIN pg_namespace AS namespace ON namespace.oid = object.relnamespace
      JOIN pg_roles AS owner_role ON owner_role.oid = object.relowner
      WHERE namespace.nspname = 'public'
        AND object.relname IN (
          SELECT table_name FROM owned_tables
          UNION ALL SELECT 'labs_id_seq'
          UNION ALL SELECT 'equipment_categories_id_seq'
          UNION ALL SELECT 'equipment_status_history_id_seq'
        )
        AND owner_role.rolname IN (
          SELECT role_name FROM service_groups
          UNION ALL SELECT role_name FROM runtime_roles
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_namespace AS namespace
      JOIN pg_roles AS owner_role ON owner_role.oid = namespace.nspowner
      WHERE namespace.nspname = 'public'
        AND owner_role.rolname IN (
          SELECT role_name FROM service_groups
          UNION ALL SELECT role_name FROM runtime_roles
        )
    ),
    'Service groups and runtime logins own no protected table, sequence, or public schema'

  UNION ALL
  SELECT
    50,
    'schema_privileges',
    NOT EXISTS (
      SELECT 1
      FROM (
        SELECT role_name FROM service_groups
        UNION ALL SELECT role_name FROM runtime_roles
      ) AS role_list
      LEFT JOIN pg_roles AS role_record ON role_record.rolname = role_list.role_name
      WHERE has_schema_privilege(role_record.oid, 'public', 'USAGE') IS NOT TRUE
         OR has_schema_privilege(role_record.oid, 'public', 'CREATE') IS TRUE
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_namespace AS namespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
      ) AS acl
      LEFT JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = 'public'
        AND acl.privilege_type = 'CREATE'
        AND (acl.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated'))
    ),
    'Groups/logins have USAGE-only; PUBLIC/anon/authenticated cannot CREATE in public'

  UNION ALL
  SELECT
    60,
    'exact_table_grant_matrix',
    NOT EXISTS (
      (SELECT role_name, table_name, privilege_type FROM expected_table_grants
       EXCEPT
       SELECT role_name, table_name, privilege_type FROM actual_table_grants)
      UNION ALL
      (SELECT role_name, table_name, privilege_type FROM actual_table_grants
       EXCEPT
       SELECT role_name, table_name, privilege_type FROM expected_table_grants)
    )
    AND NOT EXISTS (SELECT 1 FROM actual_table_grants WHERE is_grantable),
    'Exactly 18 direct table grants exist on the three service groups, none grantable'

  UNION ALL
  SELECT
    70,
    'exact_sequence_grant_matrix',
    NOT EXISTS (
      (SELECT role_name, sequence_name, privilege_type FROM expected_sequence_grants
       EXCEPT
       SELECT role_name, sequence_name, privilege_type FROM actual_sequence_grants)
      UNION ALL
      (SELECT role_name, sequence_name, privilege_type FROM actual_sequence_grants
       EXCEPT
       SELECT role_name, sequence_name, privilege_type FROM expected_sequence_grants)
    )
    AND NOT EXISTS (SELECT 1 FROM actual_sequence_grants WHERE is_grantable),
    'Only Equipment has non-grantable USAGE/SELECT on its two required sequences'

  UNION ALL
  SELECT
    80,
    'no_runtime_direct_object_grants',
    NOT EXISTS (
      SELECT 1
      FROM pg_class AS object
      JOIN pg_namespace AS namespace ON namespace.oid = object.relnamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(
          object.relacl,
          acldefault(
            (CASE WHEN object.relkind = 'S' THEN 'S' ELSE 'r' END)::"char",
            object.relowner
          )
        )
      ) AS acl
      JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = 'public'
        AND object.relname IN (
          SELECT table_name FROM owned_tables
          UNION ALL SELECT 'labs_id_seq'
          UNION ALL SELECT 'equipment_categories_id_seq'
          UNION ALL SELECT 'equipment_status_history_id_seq'
        )
        AND grantee.rolname IN (SELECT role_name FROM runtime_roles)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_namespace AS namespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
      ) AS acl
      JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = 'public'
        AND grantee.rolname IN (SELECT role_name FROM runtime_roles)
    ),
    'Runtime logins receive schema/object access only through their matching groups'

  UNION ALL
  SELECT
    90,
    'rls_enabled',
    (SELECT count(*)
     FROM pg_class AS object
     JOIN pg_namespace AS namespace ON namespace.oid = object.relnamespace
     WHERE namespace.nspname = 'public'
       AND object.relname IN (SELECT table_name FROM owned_tables)
       AND object.relkind IN ('r', 'p')
       AND object.relrowsecurity) = 10,
    'RLS is enabled on all ten protected UniTrack tables'

  UNION ALL
  SELECT
    100,
    'exact_service_policy_matrix',
    (SELECT count(*)
     FROM expected_policies AS expected_policy
     JOIN pg_policies AS actual_policy
       ON actual_policy.schemaname = 'public'
      AND actual_policy.tablename = expected_policy.table_name
      AND actual_policy.policyname = format(
        '%s_%s_%s',
        expected_policy.group_name,
        expected_policy.table_name,
        lower(expected_policy.command_name)
      )
      AND actual_policy.cmd = expected_policy.command_name
      AND actual_policy.permissive = 'PERMISSIVE'
      AND actual_policy.roles = ARRAY[expected_policy.group_name]::name[]
      AND CASE
        WHEN expected_policy.using_true THEN
          lower(regexp_replace(COALESCE(actual_policy.qual, ''), '[()[:space:]]', '', 'g')) = 'true'
        ELSE actual_policy.qual IS NULL
      END
      AND CASE
        WHEN expected_policy.check_true THEN
          lower(regexp_replace(COALESCE(actual_policy.with_check, ''), '[()[:space:]]', '', 'g')) = 'true'
        ELSE actual_policy.with_check IS NULL
      END) = 18
    AND (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public'
           AND policyname LIKE 'unitrack\_%\_service\_%' ESCAPE '\') = 18,
    'Exactly 18 permissive role/command policies exist with true USING/WITH CHECK clauses'

  UNION ALL
  SELECT
    110,
    'public_and_browser_object_access_revoked',
    NOT EXISTS (
      SELECT 1
      FROM pg_class AS object
      JOIN pg_namespace AS namespace ON namespace.oid = object.relnamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(
          object.relacl,
          acldefault(
            (CASE WHEN object.relkind = 'S' THEN 'S' ELSE 'r' END)::"char",
            object.relowner
          )
        )
      ) AS acl
      LEFT JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = 'public'
        AND object.relname IN (
          SELECT table_name FROM owned_tables
          UNION ALL SELECT 'labs_id_seq'
          UNION ALL SELECT 'equipment_categories_id_seq'
          UNION ALL SELECT 'equipment_status_history_id_seq'
        )
        AND (acl.grantee = 0 OR grantee.rolname IN ('anon', 'authenticated'))
    ),
    'PUBLIC, anon, and authenticated have no direct protected table/sequence grants'

  UNION ALL
  SELECT
    120,
    'no_unexpected_object_grantees',
    NOT EXISTS (
      SELECT 1
      FROM pg_class AS object
      JOIN pg_namespace AS namespace ON namespace.oid = object.relnamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(
          object.relacl,
          acldefault(
            (CASE WHEN object.relkind = 'S' THEN 'S' ELSE 'r' END)::"char",
            object.relowner
          )
        )
      ) AS acl
      LEFT JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = 'public'
        AND object.relname IN (
          SELECT table_name FROM owned_tables
          UNION ALL SELECT 'labs_id_seq'
          UNION ALL SELECT 'equipment_categories_id_seq'
          UNION ALL SELECT 'equipment_status_history_id_seq'
        )
        AND acl.grantee <> object.relowner
        AND acl.grantee <> 0
        AND grantee.rolname NOT IN (
          SELECT role_name FROM service_groups
          UNION ALL SELECT 'service_role'
        )
    ),
    'Only object owners, service groups, and managed service_role retain protected-object ACLs'

  UNION ALL
  SELECT
    130,
    'runtime_effective_allowed_access',
    NOT EXISTS (
      SELECT 1
      FROM expected_table_grants AS expected_grant
      JOIN runtime_roles AS runtime_role
        ON runtime_role.group_name = expected_grant.role_name
      LEFT JOIN pg_roles AS login_role ON login_role.rolname = runtime_role.role_name
      LEFT JOIN pg_class AS object
        ON object.relname = expected_grant.table_name
       AND object.relnamespace = (
         SELECT oid FROM pg_namespace WHERE nspname = 'public'
       )
      WHERE has_table_privilege(
        login_role.oid,
        object.oid,
        expected_grant.privilege_type
      ) IS NOT TRUE
    )
    AND NOT EXISTS (
      SELECT 1
      FROM expected_sequence_grants AS expected_grant
      JOIN runtime_roles AS runtime_role
        ON runtime_role.group_name = expected_grant.role_name
      LEFT JOIN pg_roles AS login_role ON login_role.rolname = runtime_role.role_name
      LEFT JOIN pg_class AS object
        ON object.relname = expected_grant.sequence_name
       AND object.relnamespace = (
         SELECT oid FROM pg_namespace WHERE nspname = 'public'
       )
      WHERE has_sequence_privilege(
        login_role.oid,
        object.oid,
        expected_grant.privilege_type
      ) IS NOT TRUE
    )
    AND NOT EXISTS (
      SELECT 1
      FROM runtime_roles AS runtime_role
      LEFT JOIN pg_roles AS login_role ON login_role.rolname = runtime_role.role_name
      WHERE has_database_privilege(login_role.oid, current_database(), 'CONNECT') IS NOT TRUE
    ),
    'Each runtime login inherits every approved table/sequence privilege and can CONNECT'

  UNION ALL
  SELECT
    140,
    'runtime_cross_service_access_denied',
    NOT EXISTS (
      SELECT 1
      FROM runtime_roles AS runtime_role
      JOIN owned_tables AS protected_table
        ON protected_table.owner_group <> runtime_role.group_name
      CROSS JOIN (VALUES
        ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
        ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
      ) AS privilege(privilege_type)
      LEFT JOIN pg_roles AS login_role ON login_role.rolname = runtime_role.role_name
      LEFT JOIN pg_class AS object
        ON object.relname = protected_table.table_name
       AND object.relnamespace = (
         SELECT oid FROM pg_namespace WHERE nspname = 'public'
       )
      WHERE has_table_privilege(
        login_role.oid,
        object.oid,
        privilege.privilege_type
      ) IS TRUE
    ),
    'No runtime login has any table privilege on another service owner''s tables'
),
all_checks AS (
  SELECT * FROM checks
  UNION ALL
  SELECT
    0,
    '00_overall_006_gate',
    bool_and(passed),
    'Every automated migration-006 isolation check passes'
  FROM checks
)
SELECT
  check_name,
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS status,
  expected
FROM all_checks
ORDER BY sort_order, check_name;
