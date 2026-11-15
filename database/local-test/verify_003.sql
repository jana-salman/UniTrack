DO $$
DECLARE
  column_type text;
  nullable text;
BEGIN
  SELECT data_type, is_nullable
  INTO column_type, nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'equipment_status_history'
    AND column_name = 'request_fingerprint';

  IF column_type IS DISTINCT FROM 'text' OR nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION '003 verification failed: request_fingerprint must be nullable text';
  END IF;

  IF (SELECT request_fingerprint IS NOT NULL
      FROM public.equipment_status_history
      WHERE request_key = 'local:legacy:receipt') THEN
    RAISE EXCEPTION '003 verification failed: legacy receipt was backfilled';
  END IF;

  IF (SELECT count(*) FROM public.equipment_status_history) <> 1 THEN
    RAISE EXCEPTION '003 verification failed: baseline history row count changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.equipment_status_history'::regclass
      AND tgname = 'equipment_status_history_immutable'
      AND tgenabled <> 'D'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '003 verification failed: immutable-history trigger is not enabled';
  END IF;
END;
$$;

SELECT 'PASS: migration 003 structure and baseline preservation' AS result;
