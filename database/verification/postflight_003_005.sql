-- Read-only post-migration verification for migrations 003, 004, and 005.
-- Run as one query in Supabase SQL Editor. It reads catalogs only.
WITH function_definitions AS (
  SELECT
    p.proname,
    p.prorettype = 'pg_catalog.trigger'::regtype AS returns_trigger,
    l.lanname = 'plpgsql' AS uses_plpgsql,
    NOT p.prosecdef AS uses_invoker_security,
    lower(regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g')) AS definition
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_language AS l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'clear_equipment_status_owner',
      'record_equipment_status_owner'
    )
    AND pg_get_function_identity_arguments(p.oid) = ''
),
checks AS (
  SELECT
    10 AS sort_order,
    '003'::text AS migration,
    'request_fingerprint_column'::text AS check_name,
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'equipment_status_history'
        AND column_name = 'request_fingerprint'
        AND data_type = 'text'
        AND is_nullable = 'YES'
        AND column_default IS NULL
    ) AS passed,
    'public.equipment_status_history.request_fingerprint is nullable text with no default'::text AS expected

  UNION ALL
  SELECT
    20,
    '003',
    'request_key_prerequisite_index',
    EXISTS (
      SELECT 1
      FROM pg_index AS i
      JOIN pg_class AS idx ON idx.oid = i.indexrelid
      JOIN pg_class AS tbl ON tbl.oid = i.indrelid
      JOIN pg_namespace AS n ON n.oid = tbl.relnamespace
      WHERE n.nspname = 'public'
        AND tbl.relname = 'equipment_status_history'
        AND idx.relname = 'equipment_status_history_request_key_unique'
        AND i.indisunique
        AND i.indisvalid
        AND i.indisready
        AND pg_get_expr(i.indpred, i.indrelid) = '(request_key IS NOT NULL)'
    ),
    'request_key unique partial index remains valid and ready'

  UNION ALL
  SELECT
    30,
    '004',
    'return_operation_column',
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'loans'
        AND column_name = 'return_operation'
        AND data_type = 'jsonb'
        AND is_nullable = 'YES'
        AND column_default IS NULL
    ),
    'public.loans.return_operation is nullable jsonb with no default'

  UNION ALL
  SELECT
    40,
    '004',
    'active_loan_prerequisite_index',
    EXISTS (
      SELECT 1
      FROM pg_index AS i
      JOIN pg_class AS idx ON idx.oid = i.indexrelid
      JOIN pg_class AS tbl ON tbl.oid = i.indrelid
      JOIN pg_namespace AS n ON n.oid = tbl.relnamespace
      WHERE n.nspname = 'public'
        AND tbl.relname = 'loans'
        AND idx.relname = 'loans_one_active_per_item'
        AND i.indisunique
        AND i.indisvalid
        AND i.indisready
        AND pg_get_expr(i.indpred, i.indrelid) = '(returned_at IS NULL)'
    ),
    'active-loan unique partial index remains valid and ready'

  UNION ALL
  SELECT
    50,
    '005',
    'status_request_key_column',
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'equipment_items'
        AND column_name = 'status_request_key'
        AND data_type = 'text'
        AND is_nullable = 'YES'
        AND column_default IS NULL
    ),
    'public.equipment_items.status_request_key is nullable text with no default'

  UNION ALL
  SELECT
    60,
    '005',
    'clear_owner_function',
    COALESCE((
      SELECT count(*) = 1
        AND bool_and(returns_trigger)
        AND bool_and(uses_plpgsql)
        AND bool_and(uses_invoker_security)
        AND bool_and(position('new.status_request_key := null;' IN definition) > 0)
        AND bool_and(position('return new;' IN definition) > 0)
      FROM function_definitions
      WHERE proname = 'clear_equipment_status_owner'
    ), false),
    'clear_equipment_status_owner() is the reviewed invoker-security trigger function'

  UNION ALL
  SELECT
    70,
    '005',
    'record_owner_function',
    COALESCE((
      SELECT count(*) = 1
        AND bool_and(returns_trigger)
        AND bool_and(uses_plpgsql)
        AND bool_and(uses_invoker_security)
        AND bool_and(position('update public.equipment_items' IN definition) > 0)
        AND bool_and(position('status = new.new_status' IN definition) > 0)
        AND bool_and(position('then new.request_key else null end' IN definition) > 0)
        AND bool_and(position('id = new.item_id and lab_id = new.lab_id' IN definition) > 0)
        AND bool_and(position('return new;' IN definition) > 0)
      FROM function_definitions
      WHERE proname = 'record_equipment_status_owner'
    ), false),
    'record_equipment_status_owner() is the reviewed invoker-security trigger function'

  UNION ALL
  SELECT
    80,
    '005',
    'clear_owner_trigger',
    COALESCE((
      SELECT count(*) = 1
        AND bool_and(t.tgenabled <> 'D')
        AND bool_and(t.tgtype = 19)
        AND bool_and(t.tgfoid = to_regprocedure('public.clear_equipment_status_owner()'))
        AND bool_and(t.tgattr::text = a.attnum::text)
      FROM pg_trigger AS t
      JOIN pg_attribute AS a
        ON a.attrelid = t.tgrelid
       AND a.attname = 'status'
       AND NOT a.attisdropped
      WHERE t.tgrelid = to_regclass('public.equipment_items')
        AND t.tgname = 'equipment_status_owner_clear'
        AND NOT t.tgisinternal
    ), false),
    'equipment_status_owner_clear is enabled BEFORE ROW UPDATE OF status'

  UNION ALL
  SELECT
    90,
    '005',
    'record_owner_trigger',
    COALESCE((
      SELECT count(*) = 1
        AND bool_and(t.tgenabled <> 'D')
        AND bool_and(t.tgtype = 5)
        AND bool_and(t.tgfoid = to_regprocedure('public.record_equipment_status_owner()'))
        AND bool_and(t.tgattr::text = '')
      FROM pg_trigger AS t
      WHERE t.tgrelid = to_regclass('public.equipment_status_history')
        AND t.tgname = 'equipment_status_owner_record'
        AND NOT t.tgisinternal
    ), false),
    'equipment_status_owner_record is enabled AFTER ROW INSERT'

  UNION ALL
  SELECT
    100,
    '003-005',
    'baseline_protection_triggers',
    NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('equipment_items'::text, 'equipment_items_set_updated_at'::text),
        ('equipment_status_history', 'equipment_status_history_immutable'),
        ('loans', 'loans_prevent_delete'),
        ('condition_records', 'condition_records_prevent_delete')
      ) AS required(table_name, trigger_name)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_trigger AS t
        JOIN pg_class AS c ON c.oid = t.tgrelid
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = required.table_name
          AND t.tgname = required.trigger_name
          AND t.tgenabled <> 'D'
          AND NOT t.tgisinternal
      )
    ),
    'all four baseline protection triggers remain present and enabled'
),
results AS (
  SELECT
    sort_order,
    migration,
    check_name,
    CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,
    expected
  FROM checks
),
final_results AS (
  SELECT * FROM results
  UNION ALL
  SELECT
    999,
    'OVERALL',
    '003_005_POST_MIGRATION',
    CASE WHEN bool_and(COALESCE(passed, false)) THEN 'PASS' ELSE 'FAIL' END,
    CASE
      WHEN bool_and(COALESCE(passed, false)) THEN 'All post-migration checks passed.'
      ELSE 'One or more checks failed; stop and review the failing rows.'
    END
  FROM checks
)
SELECT migration, check_name, result, expected
FROM final_results
ORDER BY sort_order;
