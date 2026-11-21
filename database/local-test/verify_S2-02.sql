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

-- Exercise the confirmed-only half-open exclusion constraint in the disposable
-- database. The surrounding transaction always rolls its synthetic rows back.
BEGIN;
INSERT INTO public.reservations
  (id, item_id, borrower_id, lab_id, start_at, end_at, status)
VALUES
  ('00000000-0000-4000-8000-000000009201', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 7001, '2090-01-01T00:00:00Z', '2090-01-03T00:00:00Z', 'confirmed');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.reservations
      (id, item_id, borrower_id, lab_id, start_at, end_at, status)
    VALUES
      ('00000000-0000-4000-8000-000000009202', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 7001, '2090-01-02T00:00:00Z', '2090-01-04T00:00:00Z', 'confirmed');
    RAISE EXCEPTION 'S2-02 verification failed: overlapping confirmed reservation was accepted.';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;
  END;

  INSERT INTO public.reservations
    (id, item_id, borrower_id, lab_id, start_at, end_at, status)
  VALUES
    ('00000000-0000-4000-8000-000000009203', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 7001, '2090-01-03T00:00:00Z', '2090-01-04T00:00:00Z', 'confirmed'),
    ('00000000-0000-4000-8000-000000009204', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000002', 7001, '2090-01-02T00:00:00Z', '2090-01-04T00:00:00Z', 'confirmed'),
    ('00000000-0000-4000-8000-000000009205', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 7001, '2090-01-02T00:00:00Z', '2090-01-04T00:00:00Z', 'pending'),
    ('00000000-0000-4000-8000-000000009206', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 7001, '2090-01-02T00:00:00Z', '2090-01-04T00:00:00Z', 'cancelled');
END;
$$;
ROLLBACK;

SELECT 'PASS: S2-02 confirmed reservation exclusion constraint' AS result;
