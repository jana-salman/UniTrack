-- UniTrack migrations 003-005: read-only preflight
--
-- Purpose:
--   Verify the remaining live-database prerequisites before an authorized
--   operator applies migrations 003, 004 and 005, in that order.
--
-- Safety:
--   This script is one catalog/data SELECT. It does not acquire advisory/row
--   locks, execute migration DDL, call nextval(), or test triggers by writing
--   rows. One result grid makes Supabase SQL Editor export straightforward.
--
-- Already verified outside this script at the current checkpoint:
--   * all ten baseline tables exist;
--   * the four baseline protection triggers exist and are enabled;
--   * request_key is nullable text and its named unique partial index is
--     valid, ready and correctly defined;
--   * the target columns from 003, 004 and 005 are currently absent.
--
-- The request-key dependency and target-column absence are asserted again
-- here because they are direct migration gates. The script deliberately does
-- not repeat the full ten-table or baseline-trigger audit.

-- The result contains automated PASS/FAIL gates and INFO inventory rows.
WITH
owned_tables(table_name) AS (
  VALUES
    ('labs'),
    ('profiles'),
    ('equipment_categories'),
    ('equipment_items'),
    ('kits'),
    ('kit_components'),
    ('equipment_status_history'),
    ('reservations'),
    ('loans'),
    ('condition_records')
),
required_columns(table_name, column_name, type_name, must_be_not_null) AS (
  VALUES
    ('equipment_items', 'id', 'uuid', true),
    ('equipment_items', 'lab_id', 'int4', true),
    ('equipment_items', 'status', 'varchar', true),
    ('equipment_status_history', 'item_id', 'uuid', true),
    ('equipment_status_history', 'lab_id', 'int4', true),
    ('equipment_status_history', 'old_status', 'varchar', false),
    ('equipment_status_history', 'new_status', 'varchar', true),
    ('equipment_status_history', 'changed_by', 'uuid', false),
    ('equipment_status_history', 'reason', 'text', false),
    ('equipment_status_history', 'request_key', 'text', false),
    ('reservations', 'id', 'uuid', true),
    ('reservations', 'item_id', 'uuid', true),
    ('reservations', 'borrower_id', 'uuid', true),
    ('reservations', 'lab_id', 'int4', true),
    ('reservations', 'start_at', 'timestamptz', true),
    ('reservations', 'end_at', 'timestamptz', true),
    ('reservations', 'status', 'varchar', true),
    ('loans', 'id', 'uuid', true),
    ('loans', 'item_id', 'uuid', true),
    ('loans', 'borrower_id', 'uuid', true),
    ('loans', 'reservation_id', 'uuid', false),
    ('loans', 'lab_id', 'int4', true),
    ('loans', 'borrowed_at', 'timestamptz', true),
    ('loans', 'due_date', 'timestamptz', true),
    ('loans', 'returned_at', 'timestamptz', false),
    ('condition_records', 'id', 'uuid', true),
    ('condition_records', 'loan_id', 'uuid', true),
    ('condition_records', 'item_id', 'uuid', true),
    ('condition_records', 'kit_component_id', 'uuid', false),
    ('condition_records', 'lab_id', 'int4', true),
    ('condition_records', 'phase', 'varchar', true),
    ('condition_records', 'condition_status', 'varchar', true),
    ('condition_records', 'notes', 'text', false),
    ('condition_records', 'recorded_by', 'uuid', false),
    ('condition_records', 'recorded_at', 'timestamptz', true)
),
actual_columns AS (
  SELECT
    table_class.relname AS table_name,
    attribute.attname AS column_name,
    type_info.typname::text AS type_name,
    attribute.attnotnull AS is_not_null
  FROM pg_class AS table_class
  JOIN pg_namespace AS namespace
    ON namespace.oid = table_class.relnamespace
  JOIN pg_attribute AS attribute
    ON attribute.attrelid = table_class.oid
  JOIN pg_type AS type_info
    ON type_info.oid = attribute.atttypid
  WHERE namespace.nspname = 'public'
    AND table_class.relkind IN ('r', 'p')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
),
target_columns(migration, table_name, column_name) AS (
  VALUES
    ('003', 'equipment_status_history', 'request_fingerprint'),
    ('004', 'loans', 'return_operation'),
    ('005', 'equipment_items', 'status_request_key')
),
expected_foreign_keys(table_name, column_name, referenced_table, referenced_column, delete_action) AS (
  VALUES
    ('equipment_items', 'category_id', 'equipment_categories', 'id', 'r'),
    ('equipment_items', 'lab_id', 'labs', 'id', 'r'),
    ('equipment_items', 'created_by', 'profiles', 'id', 'n'),
    ('equipment_status_history', 'item_id', 'equipment_items', 'id', 'r'),
    ('equipment_status_history', 'lab_id', 'labs', 'id', 'r'),
    ('equipment_status_history', 'changed_by', 'profiles', 'id', 'n'),
    ('reservations', 'item_id', 'equipment_items', 'id', 'r'),
    ('reservations', 'borrower_id', 'profiles', 'id', 'r'),
    ('reservations', 'lab_id', 'labs', 'id', 'r'),
    ('loans', 'item_id', 'equipment_items', 'id', 'r'),
    ('loans', 'borrower_id', 'profiles', 'id', 'r'),
    ('loans', 'reservation_id', 'reservations', 'id', 'r'),
    ('loans', 'lab_id', 'labs', 'id', 'r'),
    ('condition_records', 'loan_id', 'loans', 'id', 'r'),
    ('condition_records', 'item_id', 'equipment_items', 'id', 'r'),
    ('condition_records', 'kit_component_id', 'kit_components', 'id', 'r'),
    ('condition_records', 'lab_id', 'labs', 'id', 'r'),
    ('condition_records', 'recorded_by', 'profiles', 'id', 'n')
),
foreign_key_results AS (
  SELECT
    expected.*,
    EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_info
      WHERE constraint_info.contype = 'f'
        AND constraint_info.convalidated
        AND constraint_info.conrelid = to_regclass('public.' || expected.table_name)
        AND constraint_info.confrelid = to_regclass('public.' || expected.referenced_table)
        AND constraint_info.confdeltype::text = expected.delete_action
        AND array_length(constraint_info.conkey, 1) = 1
        AND array_length(constraint_info.confkey, 1) = 1
        AND (
          SELECT attribute.attname
          FROM pg_attribute AS attribute
          WHERE attribute.attrelid = constraint_info.conrelid
            AND attribute.attnum = constraint_info.conkey[1]
        ) = expected.column_name
        AND (
          SELECT attribute.attname
          FROM pg_attribute AS attribute
          WHERE attribute.attrelid = constraint_info.confrelid
            AND attribute.attnum = constraint_info.confkey[1]
        ) = expected.referenced_column
    ) AS is_valid
  FROM expected_foreign_keys AS expected
),
index_catalog AS (
  SELECT
    table_class.relname AS table_name,
    index_class.relname AS index_name,
    index_info.indisunique,
    index_info.indisvalid,
    index_info.indisready,
    pg_get_indexdef(index_info.indexrelid) AS definition,
    pg_get_expr(index_info.indpred, index_info.indrelid) AS predicate
  FROM pg_index AS index_info
  JOIN pg_class AS index_class
    ON index_class.oid = index_info.indexrelid
  JOIN pg_class AS table_class
    ON table_class.oid = index_info.indrelid
  JOIN pg_namespace AS namespace
    ON namespace.oid = table_class.relnamespace
  WHERE namespace.nspname = 'public'
),
executor AS (
  SELECT role_info.rolsuper
  FROM pg_roles AS role_info
  WHERE role_info.rolname = current_user
),
public_write_grants AS (
  SELECT
    owned_tables.table_name,
    acl.privilege_type
  FROM owned_tables
  JOIN pg_class AS table_info
    ON table_info.oid = to_regclass('public.' || owned_tables.table_name)
  CROSS JOIN LATERAL aclexplode(
    COALESCE(table_info.relacl, acldefault('r', table_info.relowner))
  ) AS acl
  WHERE acl.grantee = 0
    AND acl.privilege_type IN (
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    )
),
checks(gate, check_id, status, details) AS (
  SELECT
    'MIGRATION',
    'server_version_supports_005',
    CASE WHEN current_setting('server_version_num')::integer >= 140000
      THEN 'PASS' ELSE 'FAIL' END,
    'server_version=' || current_setting('server_version') ||
      '; migration 005 uses CREATE OR REPLACE TRIGGER (PostgreSQL 14+)'

  UNION ALL

  SELECT
    'MIGRATION',
    'return_path_columns_match_baseline',
    CASE WHEN COUNT(*) FILTER (
      WHERE actual.table_name IS NULL
        OR actual.type_name <> required.type_name
        OR actual.is_not_null <> required.must_be_not_null
    ) = 0 THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(
      string_agg(
        format(
          '%I.%I expected %s/%s; found %s/%s',
          required.table_name,
          required.column_name,
          required.type_name,
          CASE WHEN required.must_be_not_null THEN 'NOT NULL' ELSE 'NULLABLE' END,
          COALESCE(actual.type_name, 'MISSING'),
          CASE
            WHEN actual.table_name IS NULL THEN 'MISSING'
            WHEN actual.is_not_null THEN 'NOT NULL'
            ELSE 'NULLABLE'
          END
        ),
        '; ' ORDER BY required.table_name, required.column_name
      ) FILTER (
        WHERE actual.table_name IS NULL
          OR actual.type_name <> required.type_name
          OR actual.is_not_null <> required.must_be_not_null
      ),
      'All columns used by the current return path match the expected baseline types/nullability.'
    )
  FROM required_columns AS required
  LEFT JOIN actual_columns AS actual
    ON actual.table_name = required.table_name
   AND actual.column_name = required.column_name

  UNION ALL

  SELECT
    'MIGRATION',
    'migration_' || target.migration || '_target_absent',
    CASE WHEN actual.table_name IS NULL THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN actual.table_name IS NULL
      THEN format('%I.%I is absent, so migration %s has not already been partially applied.', target.table_name, target.column_name, target.migration)
      ELSE format('%I.%I already exists as %s/%s; stop and reconcile before applying migration %s.', target.table_name, target.column_name, actual.type_name, CASE WHEN actual.is_not_null THEN 'NOT NULL' ELSE 'NULLABLE' END, target.migration)
    END
  FROM target_columns AS target
  LEFT JOIN actual_columns AS actual
    ON actual.table_name = target.table_name
   AND actual.column_name = target.column_name

  UNION ALL

  SELECT
    'MIGRATION',
    'request_key_index_prerequisite',
    CASE WHEN EXISTS (
      SELECT 1
      FROM index_catalog
      WHERE table_name = 'equipment_status_history'
        AND index_name = 'equipment_status_history_request_key_unique'
        AND indisunique
        AND indisvalid
        AND indisready
        AND definition ~* '\(request_key\)'
        AND predicate ~* 'request_key\s+IS\s+NOT\s+NULL'
    ) THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(
      (
        SELECT format('unique=%s valid=%s ready=%s definition=%s', indisunique, indisvalid, indisready, definition)
        FROM index_catalog
        WHERE table_name = 'equipment_status_history'
          AND index_name = 'equipment_status_history_request_key_unique'
      ),
      'The named request-key index is missing.'
    )

  UNION ALL

  SELECT
    'MIGRATION',
    'active_loan_index',
    CASE WHEN EXISTS (
      SELECT 1
      FROM index_catalog
      WHERE table_name = 'loans'
        AND index_name = 'loans_one_active_per_item'
        AND indisunique
        AND indisvalid
        AND indisready
        AND definition ~* '\(item_id\)'
        AND predicate ~* 'returned_at\s+IS\s+NULL'
    ) THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(
      (
        SELECT format('unique=%s valid=%s ready=%s definition=%s', indisunique, indisvalid, indisready, definition)
        FROM index_catalog
        WHERE table_name = 'loans'
          AND index_name = 'loans_one_active_per_item'
      ),
      'The named active-loan unique partial index is missing.'
    )

  UNION ALL

  SELECT
    'MIGRATION',
    'required_primary_keys',
    CASE WHEN COUNT(*) FILTER (WHERE NOT EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_info
      WHERE constraint_info.conrelid = to_regclass('public.' || required.table_name)
        AND constraint_info.contype = 'p'
        AND constraint_info.convalidated
    )) = 0 THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(
      string_agg(required.table_name, ', ' ORDER BY required.table_name)
        FILTER (WHERE NOT EXISTS (
          SELECT 1
          FROM pg_constraint AS constraint_info
          WHERE constraint_info.conrelid = to_regclass('public.' || required.table_name)
            AND constraint_info.contype = 'p'
            AND constraint_info.convalidated
        )),
      'Primary keys are present and validated on Equipment history/items, reservations, loans and condition records.'
    )
  FROM (
    VALUES
      ('equipment_items'),
      ('equipment_status_history'),
      ('reservations'),
      ('loans'),
      ('condition_records')
  ) AS required(table_name)

  UNION ALL

  SELECT
    'MIGRATION',
    'required_foreign_keys',
    CASE WHEN COUNT(*) FILTER (WHERE NOT is_valid) = 0 THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(
      string_agg(
        format('%I.%I -> %I.%I (delete=%s)', table_name, column_name, referenced_table, referenced_column, delete_action),
        '; ' ORDER BY table_name, column_name
      ) FILTER (WHERE NOT is_valid),
      'All return-path foreign keys are present and validated.'
    )
  FROM foreign_key_results

  UNION ALL

  SELECT
    'MIGRATION',
    'return_check_constraints',
    CASE WHEN
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.equipment_items'::regclass
          AND contype = 'c' AND convalidated
          AND pg_get_constraintdef(oid) ~* 'status.*available.*reserved.*checked_out.*inspection_required.*under_maintenance.*retired.*lost.*overdue'
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.loans'::regclass
          AND contype = 'c' AND convalidated
          AND pg_get_constraintdef(oid) ~* 'due_date.*borrowed_at'
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.loans'::regclass
          AND contype = 'c' AND convalidated
          AND pg_get_constraintdef(oid) ~* 'returned_at.*borrowed_at'
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.condition_records'::regclass
          AND contype = 'c' AND convalidated
          AND pg_get_constraintdef(oid) ~* 'phase.*pickup.*return.*inspection'
      )
      AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.condition_records'::regclass
          AND contype = 'c' AND convalidated
          AND pg_get_constraintdef(oid) ~* 'condition_status.*good.*damaged.*missing.*unknown'
      )
    THEN 'PASS' ELSE 'FAIL' END,
    'Requires validated Equipment status, loan date, and condition-record phase/status checks used by the return workflow.'

  UNION ALL

  SELECT
    'MIGRATION',
    'no_unvalidated_return_constraints',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN COUNT(*) = 0
      THEN 'No unvalidated constraints exist on return-path tables.'
      ELSE string_agg(format('%I.%I', table_info.relname, constraint_info.conname), '; ' ORDER BY table_info.relname, constraint_info.conname)
    END
  FROM pg_constraint AS constraint_info
  JOIN pg_class AS table_info
    ON table_info.oid = constraint_info.conrelid
  JOIN pg_namespace AS namespace
    ON namespace.oid = table_info.relnamespace
  WHERE namespace.nspname = 'public'
    AND table_info.relname IN ('equipment_items', 'equipment_status_history', 'reservations', 'loans', 'condition_records')
    AND NOT constraint_info.convalidated

  UNION ALL

  SELECT
    'MIGRATION',
    'no_005_function_name_conflicts',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN COUNT(*) = 0
      THEN 'No existing public functions would be replaced by migration 005.'
      ELSE string_agg(format('%I.%I(%s)', namespace.nspname, procedure_info.proname, pg_get_function_identity_arguments(procedure_info.oid)), '; ' ORDER BY procedure_info.proname)
    END
  FROM pg_proc AS procedure_info
  JOIN pg_namespace AS namespace
    ON namespace.oid = procedure_info.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure_info.proname IN ('clear_equipment_status_owner', 'record_equipment_status_owner')

  UNION ALL

  SELECT
    'MIGRATION',
    'no_005_trigger_name_conflicts',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN COUNT(*) = 0
      THEN 'No existing target-table triggers would be replaced by migration 005.'
      ELSE string_agg(format('%I.%I', table_info.relname, trigger_info.tgname), '; ' ORDER BY table_info.relname, trigger_info.tgname)
    END
  FROM pg_trigger AS trigger_info
  JOIN pg_class AS table_info
    ON table_info.oid = trigger_info.tgrelid
  JOIN pg_namespace AS namespace
    ON namespace.oid = table_info.relnamespace
  WHERE namespace.nspname = 'public'
    AND NOT trigger_info.tgisinternal
    AND trigger_info.tgname IN ('equipment_status_owner_clear', 'equipment_status_owner_record')

  UNION ALL

  SELECT
    'MIGRATION',
    'migration_executor_controls_targets',
    CASE WHEN COUNT(*) FILTER (
      WHERE NOT (
        (SELECT rolsuper FROM executor)
        OR pg_get_userbyid(table_info.relowner) = current_user
        OR pg_has_role(current_user, pg_get_userbyid(table_info.relowner), 'MEMBER')
      )
    ) = 0 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN COUNT(*) FILTER (
      WHERE NOT (
        (SELECT rolsuper FROM executor)
        OR pg_get_userbyid(table_info.relowner) = current_user
        OR pg_has_role(current_user, pg_get_userbyid(table_info.relowner), 'MEMBER')
      )
    ) = 0
      THEN 'current_user=' || current_user || ' controls all three ALTER TABLE targets.'
      ELSE string_agg(format('%I owned by %I', table_info.relname, pg_get_userbyid(table_info.relowner)), '; ')
        FILTER (WHERE NOT (
          (SELECT rolsuper FROM executor)
          OR pg_get_userbyid(table_info.relowner) = current_user
          OR pg_has_role(current_user, pg_get_userbyid(table_info.relowner), 'MEMBER')
        ))
    END
  FROM pg_class AS table_info
  JOIN pg_namespace AS namespace
    ON namespace.oid = table_info.relnamespace
  WHERE namespace.nspname = 'public'
    AND table_info.relname IN ('equipment_items', 'equipment_status_history', 'loans')
    AND table_info.relkind IN ('r', 'p')

  UNION ALL

  SELECT
    'MIGRATION',
    'migration_executor_can_create_in_public',
    CASE WHEN has_schema_privilege(current_user, 'public', 'CREATE') THEN 'PASS' ELSE 'FAIL' END,
    'current_user=' || current_user || '; migration 005 must create two functions in schema public.'

  UNION ALL

  SELECT
    'RUNTIME',
    'rls_enabled_on_owned_tables',
    CASE WHEN COUNT(*) FILTER (WHERE NOT table_info.relrowsecurity) = 0 THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(
      string_agg(table_info.relname, ', ' ORDER BY table_info.relname)
        FILTER (WHERE NOT table_info.relrowsecurity),
      'RLS is enabled on all ten owned public tables. Policies and role bypass still require manual review.'
    )
  FROM owned_tables
  JOIN pg_class AS table_info
    ON table_info.oid = to_regclass('public.' || owned_tables.table_name)

  UNION ALL

  SELECT
    'RUNTIME',
    'public_has_no_table_write_grants',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(
      string_agg(
        format('%I:%s', table_name, privilege_type),
        ', ' ORDER BY table_name, privilege_type
      ),
      'PUBLIC has no table-level write privileges on the ten owned tables.'
    )
  FROM public_write_grants
),
automated_report AS (
  SELECT gate, check_id, status, details
  FROM checks

  UNION ALL

  SELECT
    gate,
    '00_OVERALL_' || gate || '_GATE',
    CASE WHEN COUNT(*) FILTER (WHERE status = 'FAIL') = 0 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN COUNT(*) FILTER (WHERE status = 'FAIL') = 0
      THEN 'All automated ' || lower(gate) || ' checks passed.'
      ELSE COUNT(*) FILTER (WHERE status = 'FAIL') || ' automated check(s) failed; do not proceed for this gate.'
    END
  FROM checks
  GROUP BY gate
),
grant_inventory AS (
  SELECT
    owned_tables.table_name,
    pg_get_userbyid(table_info.relowner) AS table_owner,
    CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
    grantor.rolname AS grantor,
    acl.privilege_type,
    acl.is_grantable
  FROM owned_tables
  JOIN pg_class AS table_info
    ON table_info.oid = to_regclass('public.' || owned_tables.table_name)
  CROSS JOIN LATERAL aclexplode(
    COALESCE(table_info.relacl, acldefault('r', table_info.relowner))
  ) AS acl
  LEFT JOIN pg_roles AS grantee
    ON grantee.oid = acl.grantee
  LEFT JOIN pg_roles AS grantor
    ON grantor.oid = acl.grantor
),
policy_inventory AS (
  SELECT
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename::text IN (SELECT table_name FROM owned_tables)
),
combined_report(sort_group, gate, check_id, status, details) AS (
  SELECT 1, gate, check_id, status, details
  FROM automated_report

  UNION ALL

  SELECT
    2,
    'GRANT_INVENTORY',
    table_name || ':' || COALESCE(grantee, 'UNKNOWN') || ':' || privilege_type,
    'INFO',
    format(
      'owner=%I; grantor=%I; grantable=%s',
      table_owner,
      COALESCE(grantor, 'UNKNOWN'),
      is_grantable
    )
  FROM grant_inventory

  UNION ALL

  SELECT
    3,
    'POLICY_INVENTORY',
    tablename || ':' || policyname,
    'INFO',
    format(
      'permissive=%s; roles=%s; command=%s; using=%s; with_check=%s',
      permissive,
      roles,
      cmd,
      COALESCE(qual, 'NULL'),
      COALESCE(with_check, 'NULL')
    )
  FROM policy_inventory

  UNION ALL

  SELECT
    3,
    'POLICY_INVENTORY',
    'no_public_policies_found',
    'INFO',
    'No RLS policies exist on the ten owned public tables. RLS flags alone do not establish per-service isolation.'
  WHERE NOT EXISTS (SELECT 1 FROM policy_inventory)

  UNION ALL

  SELECT
    4,
    'LEGACY_KEY_INVENTORY',
    'existing_request_keys',
    'INFO',
    format(
      'existing_keyed_rows=%s; distinct_existing_keys=%s; these rows remain NULL after additive migration 003 and cannot be replayed in the new format',
      COUNT(*) FILTER (WHERE request_key IS NOT NULL),
      COUNT(DISTINCT request_key) FILTER (WHERE request_key IS NOT NULL)
    )
  FROM public.equipment_status_history
)
SELECT gate, check_id, status, details
FROM combined_report
ORDER BY sort_group, gate, check_id;
