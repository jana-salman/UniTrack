-- Equipment extraction: additive replay metadata; NOT executed by application setup.
-- Prerequisite: C430PRJCT-41_status_request_key.sql (already applied to shared dev).
BEGIN;
ALTER TABLE public.equipment_status_history
  ADD COLUMN IF NOT EXISTS request_fingerprint text;
COMMIT;
