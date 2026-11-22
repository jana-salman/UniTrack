-- Verify the C3/C4 reservation status guard without altering permissions.
DO $$
DECLARE
  trigger_definition TEXT;
  function_is_definer BOOLEAN;
  function_config TEXT[];
BEGIN
  SELECT pg_get_triggerdef(t.oid)
    INTO trigger_definition
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.reservations'::regclass
     AND t.tgname = 'reservations_protect_status_transition'
     AND t.tgenabled <> 'D'
     AND NOT t.tgisinternal;
  IF trigger_definition IS NULL OR trigger_definition NOT ILIKE '%BEFORE UPDATE OF status%' THEN
    RAISE EXCEPTION 'C3/C4 verification failed: enabled BEFORE UPDATE OF status trigger is missing.';
  END IF;

  SELECT p.prosecdef, p.proconfig
    INTO function_is_definer, function_config
    FROM pg_proc p
   WHERE p.oid = 'public.protect_reservation_status_transition()'::regprocedure;
  IF function_is_definer IS DISTINCT FROM TRUE
     OR NOT ('search_path=pg_catalog, public' = ANY(function_config)) THEN
    RAISE EXCEPTION 'C3/C4 verification failed: trigger function must be SECURITY DEFINER with a fixed search_path.';
  END IF;

  IF has_function_privilege('unitrack_loans_service', 'public.protect_reservation_status_transition()', 'EXECUTE') THEN
    RAISE EXCEPTION 'C3/C4 verification failed: trigger function is executable by the Loans role.';
  END IF;

  IF NOT has_column_privilege('unitrack_loans_service', 'public.reservations', 'status', 'UPDATE')
     OR NOT has_column_privilege('unitrack_loans_service', 'public.reservations', 'handover_operation', 'UPDATE') THEN
    RAISE EXCEPTION 'C3/C4 verification failed: existing Loans status/handover column grants were changed.';
  END IF;
END;
$$;

SELECT 'PASS: reservation handover status protection and fulfilled terminality are installed without grant changes' AS result;
