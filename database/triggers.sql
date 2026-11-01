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