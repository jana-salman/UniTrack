-- Return-Saga compensation ownership. Review/apply separately; never run at startup.
-- Prerequisite: existing request_key column/unique index and fingerprint migration 003.
-- Existing items start unknown (NULL); no history or legacy receipt is backfilled.
BEGIN;
ALTER TABLE public.equipment_items ADD COLUMN IF NOT EXISTS status_request_key text;

CREATE OR REPLACE FUNCTION public.clear_equipment_status_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Even an explicit same-value status write invalidates the earlier action.
  NEW.status_request_key := NULL;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER equipment_status_owner_clear
BEFORE UPDATE OF status ON public.equipment_items
FOR EACH ROW EXECUTE FUNCTION public.clear_equipment_status_owner();

CREATE OR REPLACE FUNCTION public.record_equipment_status_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The parent row lock serializes this with every status update. This runs
  -- in the SAME transaction as history insertion, including legacy writers.
  UPDATE public.equipment_items
  SET status_request_key = CASE WHEN status = NEW.new_status THEN NEW.request_key ELSE NULL END
  WHERE id = NEW.item_id AND lab_id = NEW.lab_id;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER equipment_status_owner_record
AFTER INSERT ON public.equipment_status_history
FOR EACH ROW EXECUTE FUNCTION public.record_equipment_status_owner();
COMMIT;
