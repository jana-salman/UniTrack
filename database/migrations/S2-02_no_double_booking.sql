-- S2-02: Prevent overlapping confirmed reservations for the same equipment.
-- Review and apply separately; never run against the shared database without approval.
--
-- Only confirmed reservations block overlapping time slots.
-- Half-open ranges [) allow one reservation to start exactly when another ends.
-- This constraint also protects against concurrent reservation requests.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.reservations
ADD CONSTRAINT reservations_no_overlapping_confirmed
EXCLUDE USING gist (
    item_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
)
WHERE (status = 'confirmed');

COMMIT;
