CREATE OR REPLACE FUNCTION public.set_equipment_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER equipment_items_set_updated_at
BEFORE UPDATE ON public.equipment_items
FOR EACH ROW
EXECUTE FUNCTION public.set_equipment_updated_at();

-- ==========================================
-- PREVENT STATUS HISTORY MODIFICATION
-- ==========================================

CREATE OR REPLACE FUNCTION public.prevent_status_history_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Equipment status history records cannot be updated or deleted';
END;
$$;


CREATE OR REPLACE TRIGGER equipment_status_history_immutable
BEFORE UPDATE OR DELETE
ON public.equipment_status_history
FOR EACH ROW
EXECUTE FUNCTION public.prevent_status_history_changes();