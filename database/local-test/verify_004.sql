DO $$
DECLARE
  column_type text;
  nullable text;
BEGIN
  SELECT data_type, is_nullable
  INTO column_type, nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'loans'
    AND column_name = 'return_operation';

  IF column_type IS DISTINCT FROM 'jsonb' OR nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION '004 verification failed: return_operation must be nullable jsonb';
  END IF;

  IF EXISTS (SELECT 1 FROM public.loans WHERE return_operation IS NOT NULL) THEN
    RAISE EXCEPTION '004 verification failed: existing loan was backfilled';
  END IF;

  IF (SELECT count(*) FROM public.loans) <> 1
     OR (SELECT count(*) FROM public.condition_records) <> 1 THEN
    RAISE EXCEPTION '004 verification failed: baseline loan/condition row counts changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid = 'public.loans_one_active_per_item'::regclass
      AND indisunique
      AND indisvalid
      AND indisready
      AND pg_get_expr(indpred, indrelid) = '(returned_at IS NULL)'
  ) THEN
    RAISE EXCEPTION '004 verification failed: active-loan index is not valid and ready';
  END IF;
END;
$$;

SELECT 'PASS: migration 004 structure, index, and baseline preservation' AS result;
