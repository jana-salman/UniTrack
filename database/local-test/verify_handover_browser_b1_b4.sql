-- Read-only database verification after the tester completes browser cases
-- B1-B4. This does not prove the browser observations; record those separately.
\set ON_ERROR_STOP on

BEGIN READ ONLY;

DO $$
DECLARE
  b123_loan uuid;
  b4_loan uuid;
BEGIN
  SELECT id INTO b123_loan
  FROM public.loans
  WHERE reservation_id = '00000000-0000-4000-8000-000000009922';

  SELECT id INTO b4_loan
  FROM public.loans
  WHERE reservation_id = '00000000-0000-4000-8000-000000009923';

  IF b123_loan IS NULL OR b4_loan IS NULL THEN
    RAISE EXCEPTION 'B1-B4 verification failed: B3 and B4 must each create one loan';
  END IF;

  IF EXISTS (
    SELECT reservation_id
    FROM public.loans
    WHERE reservation_id IN (
      '00000000-0000-4000-8000-000000009922',
      '00000000-0000-4000-8000-000000009923'
    )
    GROUP BY reservation_id
    HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'B1-B4 verification failed: duplicate handover loan';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reservations
    WHERE id IN (
      '00000000-0000-4000-8000-000000009922',
      '00000000-0000-4000-8000-000000009923'
    )
      AND (status <> 'fulfilled' OR handover_operation->>'state' <> 'completed')
  ) THEN
    RAISE EXCEPTION 'B1-B4 verification failed: reservation is not fulfilled/completed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.loans
    WHERE id IN (b123_loan, b4_loan)
      AND (student_confirmed_at IS NULL
           OR university_id_verified_at IS NULL
           OR university_id_verified_by IS NULL
           OR returned_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'B1-B4 verification failed: confirmation/ID evidence missing or loan already returned';
  END IF;

  IF (SELECT count(*) FROM public.condition_records
      WHERE loan_id = b123_loan AND phase = 'pickup') <> 6 THEN
    RAISE EXCEPTION 'B3 verification failed: expected main item plus five pickup records';
  END IF;

  IF (SELECT count(*)
      FROM public.condition_records cr
      JOIN public.kit_components kc ON kc.id = cr.kit_component_id
      WHERE cr.loan_id = b123_loan
        AND cr.phase = 'pickup'
        AND kc.component_name = 'Charger'
        AND cr.condition_status = 'missing'
        AND cr.notes = 'Charger not in the case') <> 1 THEN
    RAISE EXCEPTION 'B3 verification failed: Charger missing note does not match';
  END IF;

  IF (SELECT count(*) FROM public.condition_records
      WHERE loan_id = b4_loan
        AND phase = 'pickup'
        AND kit_component_id IS NULL
        AND condition_status = 'damaged'
        AND notes = 'Crack on front casing') <> 1
     OR (SELECT count(*) FROM public.condition_records
         WHERE loan_id = b4_loan AND phase = 'pickup') <> 1 THEN
    RAISE EXCEPTION 'B4 verification failed: expected one damaged main-item record with the agreed note';
  END IF;
END;
$$;

SELECT r.id AS reservation_id,
       r.status AS reservation_status,
       r.handover_operation->>'state' AS handover_state,
       i.asset_code,
       i.status AS equipment_status,
       l.id AS loan_id,
       l.student_confirmed_at,
       l.university_id_verified_at,
       l.university_id_verified_by,
       count(cr.id)::integer AS pickup_records
FROM public.reservations r
JOIN public.equipment_items i ON i.id = r.item_id
JOIN public.loans l ON l.reservation_id = r.id
JOIN public.condition_records cr ON cr.loan_id = l.id AND cr.phase = 'pickup'
WHERE r.id IN (
  '00000000-0000-4000-8000-000000009922',
  '00000000-0000-4000-8000-000000009923'
)
GROUP BY r.id, r.status, r.handover_operation, i.asset_code, i.status,
         l.id, l.student_confirmed_at, l.university_id_verified_at,
         l.university_id_verified_by
ORDER BY r.id;

ROLLBACK;

SELECT 'PASS: B1-B4 persisted outcomes match the dedicated local fixture' AS result;
