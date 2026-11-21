-- S2-01: Verify reservation permissions for the Loans service.
-- Run after S2-01_reservation_permissions.sql.

-- 1. Verify the Loans role and reservation INSERT permissions.
DO $$
DECLARE
  required_column text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'unitrack_loans_service'
  ) THEN
    RAISE EXCEPTION
      'S2-01 verification failed: Loans service role is missing.';
  END IF;

  FOREACH required_column IN ARRAY ARRAY[
    'item_id',
    'borrower_id',
    'lab_id',
    'start_at',
    'end_at',
    'status'
  ]
  LOOP
    IF NOT has_column_privilege(
      'unitrack_loans_service',
      'public.reservations',
      required_column,
      'INSERT'
    ) THEN
      RAISE EXCEPTION
        'S2-01 verification failed: missing INSERT permission on reservations.% ',
        required_column;
    END IF;
  END LOOP;
END;
$$;


-- 2. Verify UPDATE(status) is allowed,
--    but other reservation columns cannot be updated.
DO $$
DECLARE
  restricted_column text;
BEGIN
  IF NOT has_column_privilege(
    'unitrack_loans_service',
    'public.reservations',
    'status',
    'UPDATE'
  ) THEN
    RAISE EXCEPTION
      'S2-01 verification failed: missing UPDATE permission on reservations.status.';
  END IF;

  FOREACH restricted_column IN ARRAY ARRAY[
    'item_id',
    'borrower_id',
    'lab_id',
    'start_at',
    'end_at',
    'created_at'
  ]
  LOOP
    IF has_column_privilege(
      'unitrack_loans_service',
      'public.reservations',
      restricted_column,
      'UPDATE'
    ) THEN
      RAISE EXCEPTION
        'S2-01 verification failed: unexpected UPDATE permission on reservations.% ',
        restricted_column;
    END IF;
  END LOOP;
END;
$$;


-- 3. Verify the reservation INSERT RLS policy.
DO $$
DECLARE
  policy_record record;
BEGIN
  SELECT cmd, roles, with_check
  INTO policy_record
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'reservations'
    AND policyname = 'unitrack_loans_service_reservations_insert';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'S2-01 verification failed: reservation INSERT policy is missing.';
  END IF;

  IF policy_record.cmd <> 'INSERT'
     OR NOT ('unitrack_loans_service' = ANY(policy_record.roles))
     OR policy_record.with_check IS NULL
     OR regexp_replace(
          regexp_replace(
            lower(policy_record.with_check),
            '::(character varying|varchar|text)',
            '',
            'g'
          ),
          '[[:space:]()]',
          '',
          'g'
        ) <> 'status=''confirmed''' THEN
    RAISE EXCEPTION
      'S2-01 verification failed: reservation INSERT policy must enforce status = confirmed only.';
  END IF;
END;
$$;


-- 4. Verify S2-09 handover permissions remain intact.
DO $$
BEGIN
  IF NOT has_column_privilege(
    'unitrack_loans_service',
    'public.reservations',
    'handover_operation',
    'UPDATE'
  ) THEN
    RAISE EXCEPTION
      'S2-01 verification failed: S2-09 handover_operation UPDATE permission was lost.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reservations'
      AND policyname = 'c430prjct_40_reservations_handover_update'
  ) THEN
    RAISE EXCEPTION
      'S2-01 verification failed: S2-09 handover UPDATE policy is missing.';
  END IF;
END;
$$;


-- 5. Verify no unrestricted table-level permissions
--    or unexpected handover INSERT permission were granted.
DO $$
BEGIN
  IF has_table_privilege(
    'unitrack_loans_service',
    'public.reservations',
    'INSERT'
  ) THEN
    RAISE EXCEPTION
      'S2-01 verification failed: unrestricted table-level INSERT was granted.';
  END IF;

  IF has_table_privilege(
    'unitrack_loans_service',
    'public.reservations',
    'UPDATE'
  ) THEN
    RAISE EXCEPTION
      'S2-01 verification failed: unrestricted table-level UPDATE was granted.';
  END IF;

  IF NOT has_table_privilege(
    'unitrack_loans_service',
    'public.reservation_resources',
    'INSERT'
  ) THEN
    RAISE EXCEPTION
      'S2-01 verification failed: S2-05 reservation resource INSERT permission was lost.';
  END IF;

  IF has_column_privilege(
    'unitrack_loans_service',
    'public.reservations',
    'handover_operation',
    'INSERT'
  ) THEN
    RAISE EXCEPTION
      'S2-01 verification failed: S2-01 unexpectedly grants INSERT on handover_operation.';
  END IF;
END;
$$;


SELECT 'PASS: S2-01 reservation permissions and S2-09 handover preservation' AS result;
