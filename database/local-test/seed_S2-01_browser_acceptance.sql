-- One-shot browser fixtures for S2-01/S2-05/S2-09 acceptance.
-- Disposable migration-test database only; all identities and records are synthetic.
-- Run only after database/local-test/run.ps1 -KeepDatabase succeeds.
BEGIN;

DO $$
BEGIN
  IF current_database() <> 'unitrack_test'
     OR NOT EXISTS (SELECT 1 FROM public.labs WHERE id = 7001 AND code = 'LOCAL-TEST')
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000000002' AND role = 'student' AND lab_id = 7001)
     OR to_regclass('public.reservation_resources') IS NULL THEN
    RAISE EXCEPTION 'Refusing browser fixture seed outside the disposable local migration-test database.';
  END IF;
END;
$$;

INSERT INTO public.equipment_items (id, asset_code, name, category_id, lab_id, status, condition, is_restricted)
VALUES
 ('61000000-0000-4000-8000-000000000101', 'LOCAL-BROWSER-UPCOMING', 'Upcoming reservation item', 7101, 7001, 'available', 'good', FALSE),
 ('61000000-0000-4000-8000-000000000102', 'LOCAL-BROWSER-CURRENT', 'Current handover item', 7101, 7001, 'reserved', 'good', FALSE),
 ('61000000-0000-4000-8000-000000000103', 'LOCAL-BROWSER-EXPIRED', 'Expired reservation item', 7101, 7001, 'available', 'good', FALSE),
 ('61000000-0000-4000-8000-000000000104', 'LOCAL-BROWSER-RESTRICTED', 'Restricted reservation item', 7101, 7001, 'available', 'good', TRUE),
 ('61000000-0000-4000-8000-000000000105', 'LOCAL-BROWSER-OVERLAP', 'Overlap reservation item', 7101, 7001, 'available', 'good', FALSE),
 ('61000000-0000-4000-8000-000000000106', 'LOCAL-BROWSER-KIT', 'Bookable browser kit', 7101, 7001, 'available', 'good', FALSE),
 ('61000000-0000-4000-8000-000000000107', 'LOCAL-BROWSER-KIT-COMP1', 'Bookable kit camera', 7101, 7001, 'available', 'good', FALSE),
 ('61000000-0000-4000-8000-000000000108', 'LOCAL-BROWSER-KIT-COMP2', 'Bookable kit cable', 7101, 7001, 'available', 'good', FALSE),
 ('61000000-0000-4000-8000-000000000109', 'LOCAL-BROWSER-BOOKED-KIT', 'Already booked kit', 7101, 7001, 'available', 'good', FALSE),
 ('61000000-0000-4000-8000-000000000110', 'LOCAL-BROWSER-BOOKED-KIT-COMP', 'Booked kit component', 7101, 7001, 'available', 'good', FALSE),
 ('61000000-0000-4000-8000-000000000111', 'LOCAL-BROWSER-TARGET-KIT', 'Kit with separately booked component', 7101, 7001, 'available', 'good', FALSE),
 ('61000000-0000-4000-8000-000000000112', 'LOCAL-BROWSER-BOOKED-COMP', 'Separately booked component', 7101, 7001, 'available', 'good', FALSE);

INSERT INTO public.kits (item_id, lab_id) VALUES
 ('61000000-0000-4000-8000-000000000106', 7001),
 ('61000000-0000-4000-8000-000000000109', 7001),
 ('61000000-0000-4000-8000-000000000111', 7001);

INSERT INTO public.kit_components (kit_item_id, lab_id, component_name, tracked_item_id)
VALUES
 ('61000000-0000-4000-8000-000000000106', 7001, 'Camera', '61000000-0000-4000-8000-000000000107'),
 ('61000000-0000-4000-8000-000000000106', 7001, 'Cable', '61000000-0000-4000-8000-000000000108'),
 ('61000000-0000-4000-8000-000000000109', 7001, 'Booked component', '61000000-0000-4000-8000-000000000110'),
 ('61000000-0000-4000-8000-000000000111', 7001, 'Separately booked component', '61000000-0000-4000-8000-000000000112');

INSERT INTO public.reservations (id, item_id, borrower_id, lab_id, start_at, end_at, status)
VALUES
 ('62000000-0000-4000-8000-000000000101', '61000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 7001, date_trunc('minute', now()) + interval '3 days', date_trunc('minute', now()) + interval '4 days', 'confirmed'),
 ('62000000-0000-4000-8000-000000000102', '61000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000002', 7001, date_trunc('minute', now()) - interval '1 hour', date_trunc('minute', now()) + interval '2 hours', 'confirmed'),
 ('62000000-0000-4000-8000-000000000103', '61000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000002', 7001, date_trunc('minute', now()) - interval '3 days', date_trunc('minute', now()) - interval '2 days', 'confirmed'),
 ('62000000-0000-4000-8000-000000000104', '61000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000002', 7001, date_trunc('minute', now()) + interval '5 days', date_trunc('minute', now()) + interval '6 days', 'confirmed'),
 ('62000000-0000-4000-8000-000000000105', '61000000-0000-4000-8000-000000000109', '00000000-0000-4000-8000-000000000002', 7001, date_trunc('minute', now()) + interval '7 days', date_trunc('minute', now()) + interval '8 days', 'confirmed'),
 ('62000000-0000-4000-8000-000000000106', '61000000-0000-4000-8000-000000000112', '00000000-0000-4000-8000-000000000002', 7001, date_trunc('minute', now()) + interval '9 days', date_trunc('minute', now()) + interval '10 days', 'confirmed');

-- Explicit resource rows reproduce the Loans service's kit-aware reservations.
INSERT INTO public.reservation_resources (reservation_id, resource_item_id, lab_id, start_at, end_at, status)
SELECT r.id, r.item_id, r.lab_id, r.start_at, r.end_at, r.status
FROM public.reservations r
WHERE r.id IN ('62000000-0000-4000-8000-000000000101', '62000000-0000-4000-8000-000000000102', '62000000-0000-4000-8000-000000000103', '62000000-0000-4000-8000-000000000104', '62000000-0000-4000-8000-000000000105', '62000000-0000-4000-8000-000000000106');

INSERT INTO public.reservation_resources (reservation_id, resource_item_id, lab_id, start_at, end_at, status)
SELECT r.id, kc.tracked_item_id, r.lab_id, r.start_at, r.end_at, r.status
FROM public.reservations r
JOIN public.kit_components kc ON kc.kit_item_id = r.item_id AND kc.is_active AND kc.tracked_item_id IS NOT NULL
WHERE r.id = '62000000-0000-4000-8000-000000000105';

COMMIT;

SELECT 'S2-01/S2-05 browser fixtures seeded in disposable unitrack_test.' AS result;
