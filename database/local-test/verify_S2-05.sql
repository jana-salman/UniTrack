-- S2-05: Verify kit constraints, reservation resources and service grants.
DO $$
DECLARE
  constraint_definition text;
BEGIN
  IF to_regclass('public.reservation_resources') IS NULL THEN
    RAISE EXCEPTION 'S2-05 verification failed: reservation_resources is missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = 'public.kit_components_active_tracked_item_unique'::regclass
      AND indisunique AND indisvalid AND indisready
  ) THEN
    RAISE EXCEPTION 'S2-05 verification failed: active tracked components are not unique per kit.';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO constraint_definition
    FROM pg_constraint
   WHERE conname = 'reservation_resources_no_overlapping_confirmed'
     AND conrelid = 'public.reservation_resources'::regclass AND contype = 'x' AND convalidated;
  IF constraint_definition IS NULL OR constraint_definition NOT ILIKE '%resource_item_id%'
     OR constraint_definition NOT ILIKE '%tstzrange%' OR constraint_definition NOT ILIKE '%confirmed%' THEN
    RAISE EXCEPTION 'S2-05 verification failed: component reservation exclusion is missing or invalid.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'kit_components_lock_reservation_item' AND tgenabled <> 'D' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'kit_components_sync_reservation_resources' AND tgenabled <> 'D' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'reservation_resources_validate' AND tgenabled <> 'D' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'reservations_sync_resource_status' AND tgenabled <> 'D' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'S2-05 verification failed: kit reservation synchronization triggers are missing.';
  END IF;

  IF NOT has_table_privilege('unitrack_equipment_service', 'public.kits', 'SELECT,INSERT')
     OR NOT has_table_privilege('unitrack_equipment_service', 'public.kit_components', 'SELECT,INSERT')
     OR NOT has_column_privilege('unitrack_equipment_service', 'public.kit_components', 'is_active', 'UPDATE')
     OR has_table_privilege('unitrack_equipment_service', 'public.kit_components', 'UPDATE') THEN
    RAISE EXCEPTION 'S2-05 verification failed: Equipment kit privileges are missing or too broad.';
  END IF;
  IF NOT has_table_privilege('unitrack_loans_service', 'public.reservation_resources', 'SELECT,INSERT')
     OR NOT has_column_privilege('unitrack_loans_service', 'public.reservation_resources', 'status', 'UPDATE')
     OR has_table_privilege('unitrack_loans_service', 'public.reservation_resources', 'UPDATE') THEN
    RAISE EXCEPTION 'S2-05 verification failed: Loans resource privileges are missing or too broad.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reservation_resources' AND policyname = 'unitrack_loans_service_reservation_resources_insert')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'kit_components' AND policyname = 'unitrack_equipment_service_kit_components_update') THEN
    RAISE EXCEPTION 'S2-05 verification failed: service RLS policies are missing.';
  END IF;
END;
$$;

SELECT 'PASS: S2-05 kit integrity, reservation resource exclusion and least-privilege grants' AS result;
