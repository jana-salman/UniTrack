DO $$
DECLARE
  constraint_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'btree_gist'
  ) THEN
    RAISE EXCEPTION 'S2-02 verification failed: btree_gist extension is missing';
  END IF;

  SELECT pg_get_constraintdef(oid)
  INTO constraint_definition
  FROM pg_constraint
  WHERE conname = 'reservations_no_overlapping_confirmed'
    AND conrelid = 'public.reservations'::regclass
    AND contype = 'x'
    AND convalidated;

  IF constraint_definition IS NULL THEN
    RAISE EXCEPTION 'S2-02 verification failed: exclusion constraint is missing or not validated';
  END IF;

  IF constraint_definition NOT ILIKE '%item_id%'
     OR constraint_definition NOT ILIKE '%tstzrange%'
     OR constraint_definition NOT ILIKE '%confirmed%' THEN
    RAISE EXCEPTION 'S2-02 verification failed: exclusion constraint definition is unexpected: %',
      constraint_definition;
  END IF;
END;
$$;

SELECT 'PASS: S2-02 confirmed reservation exclusion constraint' AS result;
