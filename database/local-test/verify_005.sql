DO $$
DECLARE
  column_type text;
  nullable text;
  enabled_baseline_triggers integer;
BEGIN
  SELECT data_type, is_nullable
  INTO column_type, nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'equipment_items'
    AND column_name = 'status_request_key';

  IF column_type IS DISTINCT FROM 'text' OR nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION '005 verification failed: status_request_key must be nullable text';
  END IF;

  IF EXISTS (SELECT 1 FROM public.equipment_items WHERE status_request_key IS NOT NULL) THEN
    RAISE EXCEPTION '005 verification failed: existing equipment ownership was backfilled';
  END IF;

  IF to_regprocedure('public.clear_equipment_status_owner()') IS NULL
     OR to_regprocedure('public.record_equipment_status_owner()') IS NULL THEN
    RAISE EXCEPTION '005 verification failed: ownership functions are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.equipment_items'::regclass
      AND tgname = 'equipment_status_owner_clear'
      AND tgenabled <> 'D'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.equipment_status_history'::regclass
      AND tgname = 'equipment_status_owner_record'
      AND tgenabled <> 'D'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '005 verification failed: ownership triggers are not enabled';
  END IF;

  SELECT count(*)
  INTO enabled_baseline_triggers
  FROM pg_trigger
  WHERE tgname IN (
      'equipment_items_set_updated_at',
      'equipment_status_history_immutable',
      'loans_prevent_delete',
      'condition_records_prevent_delete'
    )
    AND tgenabled <> 'D'
    AND NOT tgisinternal;

  IF enabled_baseline_triggers <> 4 THEN
    RAISE EXCEPTION '005 verification failed: not all four baseline triggers remain enabled';
  END IF;

  IF (SELECT count(*) FROM public.equipment_items) <> 2
     OR (SELECT count(*) FROM public.equipment_status_history) <> 1 THEN
    RAISE EXCEPTION '005 verification failed: baseline equipment/history row counts changed';
  END IF;
END;
$$;

SELECT 'PASS: migration 005 structure, triggers, and baseline preservation' AS result;
