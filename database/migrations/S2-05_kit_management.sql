-- S2-05: integrity and persistence support for staff-managed kits.
-- Apply after 006, S2-02, S2-09 and 007 when using the shared migration chain.
-- Existing kits/kit_components were created by migration 002; this migration
-- strengthens their relationships and records the resources protected by a
-- confirmed reservation of a kit.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unitrack_equipment_service')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unitrack_loans_service') THEN
    RAISE EXCEPTION 'S2-05 prerequisite missing: apply migration 006 first.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS kit_components_active_tracked_item_unique
  ON public.kit_components (kit_item_id, tracked_item_id)
  WHERE tracked_item_id IS NOT NULL AND is_active;
ALTER TABLE public.kit_components
  DROP CONSTRAINT IF EXISTS kit_components_kit_item_id_component_name_key;

CREATE OR REPLACE FUNCTION public.validate_kit_main_lab()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  item_lab INTEGER;
BEGIN
  SELECT lab_id INTO item_lab FROM public.equipment_items WHERE id = NEW.item_id;
  IF item_lab IS NULL OR item_lab <> NEW.lab_id THEN
    RAISE EXCEPTION 'Kit main item and kit must belong to the same laboratory' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kits_validate_main_lab ON public.kits;
CREATE TRIGGER kits_validate_main_lab
BEFORE INSERT OR UPDATE OF item_id, lab_id ON public.kits
FOR EACH ROW EXECUTE FUNCTION public.validate_kit_main_lab();

CREATE OR REPLACE FUNCTION public.validate_kit_component_lab()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  kit_lab INTEGER;
  tracked_lab INTEGER;
BEGIN
  SELECT lab_id INTO kit_lab FROM public.kits WHERE item_id = NEW.kit_item_id;
  IF kit_lab IS NULL OR NEW.lab_id <> kit_lab THEN
    RAISE EXCEPTION 'Kit and component must belong to the same laboratory' USING ERRCODE = '23514';
  END IF;
  IF NEW.tracked_item_id IS NOT NULL THEN
    SELECT lab_id INTO tracked_lab FROM public.equipment_items WHERE id = NEW.tracked_item_id;
    IF tracked_lab IS NULL OR tracked_lab <> kit_lab THEN
      RAISE EXCEPTION 'Tracked kit component must belong to the kit laboratory' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.kits WHERE item_id = NEW.tracked_item_id) THEN
      RAISE EXCEPTION 'A kit cannot be used as a tracked component' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kit_components_validate_lab ON public.kit_components;
CREATE TRIGGER kit_components_validate_lab
BEFORE INSERT OR UPDATE OF kit_item_id, lab_id, tracked_item_id
ON public.kit_components
FOR EACH ROW EXECUTE FUNCTION public.validate_kit_component_lab();

CREATE OR REPLACE FUNCTION public.lock_kit_for_component_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('loans:item:' || NEW.kit_item_id::text, 0)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kit_components_lock_reservation_item ON public.kit_components;
CREATE TRIGGER kit_components_lock_reservation_item
BEFORE INSERT OR UPDATE OF kit_item_id, tracked_item_id, is_active
ON public.kit_components
FOR EACH ROW EXECUTE FUNCTION public.lock_kit_for_component_change();

CREATE TABLE IF NOT EXISTS public.reservation_resources (
  reservation_id UUID NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
  resource_item_id UUID NOT NULL REFERENCES public.equipment_items(id) ON DELETE RESTRICT,
  lab_id INTEGER NOT NULL REFERENCES public.labs(id) ON DELETE RESTRICT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled', 'fulfilled', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reservation_id, resource_item_id),
  CHECK (end_at > start_at)
);

CREATE OR REPLACE FUNCTION public.validate_reservation_resource()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  reservation_row public.reservations%ROWTYPE;
BEGIN
  SELECT * INTO reservation_row
    FROM public.reservations
   WHERE id = NEW.reservation_id;
  IF NOT FOUND
     OR NEW.lab_id <> reservation_row.lab_id
     OR NEW.start_at <> reservation_row.start_at
     OR NEW.end_at <> reservation_row.end_at
     OR NEW.status <> reservation_row.status
     OR NOT (
       NEW.resource_item_id = reservation_row.item_id
       OR EXISTS (
         SELECT 1 FROM public.kit_components c
          WHERE c.kit_item_id = reservation_row.item_id
            AND c.tracked_item_id = NEW.resource_item_id
            AND c.lab_id = reservation_row.lab_id
            AND c.is_active
       )
     )
  THEN
    RAISE EXCEPTION 'Reservation resource does not match the reservation or its active kit components' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservation_resources_validate ON public.reservation_resources;
CREATE TRIGGER reservation_resources_validate
BEFORE INSERT ON public.reservation_resources
FOR EACH ROW EXECUTE FUNCTION public.validate_reservation_resource();

CREATE OR REPLACE FUNCTION public.sync_kit_reservation_resources()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Confirmed reservations keep the resource snapshot they were created
  -- against. Removing a component from the current kit must not release that
  -- item for an overlapping standalone reservation while the kit is booked.
  -- A later addition is conservatively added to active reservations below.
  IF NEW.is_active AND NEW.tracked_item_id IS NOT NULL THEN
    INSERT INTO public.reservation_resources
      (reservation_id, resource_item_id, lab_id, start_at, end_at, status)
    SELECT r.id, NEW.tracked_item_id, r.lab_id, r.start_at, r.end_at, r.status
    FROM public.reservations r
    WHERE r.item_id = NEW.kit_item_id AND r.status = 'confirmed'
    ON CONFLICT (reservation_id, resource_item_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kit_components_sync_reservation_resources ON public.kit_components;
CREATE TRIGGER kit_components_sync_reservation_resources
AFTER INSERT OR UPDATE OF tracked_item_id, is_active
ON public.kit_components
FOR EACH ROW EXECUTE FUNCTION public.sync_kit_reservation_resources();

-- Backfill existing reservations and the tracked contents of each kit. If an
-- existing kit booking conflicts with a component booking, the exclusion
-- constraint intentionally stops for owner review instead of hiding it.
INSERT INTO public.reservation_resources
  (reservation_id, resource_item_id, lab_id, start_at, end_at, status)
SELECT r.id, r.item_id, r.lab_id, r.start_at, r.end_at, r.status
FROM public.reservations r
ON CONFLICT DO NOTHING;

INSERT INTO public.reservation_resources
  (reservation_id, resource_item_id, lab_id, start_at, end_at, status)
SELECT r.id, kc.tracked_item_id, r.lab_id, r.start_at, r.end_at, r.status
FROM public.reservations r
JOIN public.kit_components kc ON kc.kit_item_id = r.item_id AND kc.lab_id = r.lab_id
WHERE kc.is_active AND kc.tracked_item_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE public.reservation_resources
  ADD CONSTRAINT reservation_resources_no_overlapping_confirmed
  EXCLUDE USING gist (
    resource_item_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status = 'confirmed');

CREATE OR REPLACE FUNCTION public.sync_reservation_resource_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.reservation_resources
       SET status = NEW.status
     WHERE reservation_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservations_sync_resource_status ON public.reservations;
CREATE TRIGGER reservations_sync_resource_status
AFTER UPDATE OF status ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.sync_reservation_resource_status();

ALTER TABLE public.reservation_resources ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.kits, public.kit_components TO unitrack_equipment_service;
GRANT SELECT ON public.kits, public.kit_components TO unitrack_equipment_service;
GRANT UPDATE (is_active) ON public.kit_components TO unitrack_equipment_service;
GRANT SELECT, INSERT ON public.reservation_resources TO unitrack_loans_service;
GRANT UPDATE (status) ON public.reservation_resources TO unitrack_loans_service;

DROP POLICY IF EXISTS unitrack_equipment_service_kits_insert ON public.kits;
CREATE POLICY unitrack_equipment_service_kits_insert ON public.kits
  FOR INSERT TO unitrack_equipment_service WITH CHECK (true);
DROP POLICY IF EXISTS unitrack_equipment_service_kit_components_insert ON public.kit_components;
CREATE POLICY unitrack_equipment_service_kit_components_insert ON public.kit_components
  FOR INSERT TO unitrack_equipment_service WITH CHECK (true);
DROP POLICY IF EXISTS unitrack_equipment_service_kit_components_update ON public.kit_components;
CREATE POLICY unitrack_equipment_service_kit_components_update ON public.kit_components
  FOR UPDATE TO unitrack_equipment_service USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS unitrack_loans_service_reservation_resources_select ON public.reservation_resources;
CREATE POLICY unitrack_loans_service_reservation_resources_select ON public.reservation_resources
  FOR SELECT TO unitrack_loans_service USING (true);
DROP POLICY IF EXISTS unitrack_loans_service_reservation_resources_insert ON public.reservation_resources;
CREATE POLICY unitrack_loans_service_reservation_resources_insert ON public.reservation_resources
  FOR INSERT TO unitrack_loans_service WITH CHECK (true);
DROP POLICY IF EXISTS unitrack_loans_service_reservation_resources_update ON public.reservation_resources;
CREATE POLICY unitrack_loans_service_reservation_resources_update ON public.reservation_resources
  FOR UPDATE TO unitrack_loans_service USING (true) WITH CHECK (true);

COMMIT;
