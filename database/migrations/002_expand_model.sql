-- =========================================================
-- UniTrack Database Migration 002
-- Jira: S1-04 — Design the Data Model
--
-- Expands the original database and applies Product Owner
-- corrections without deleting existing data.
--
-- Initial laboratory:
-- Electronics Lab (ELEC)
-- =========================================================

BEGIN;


-- =========================================================
-- 1. CREATE LABS TABLE
-- =========================================================

CREATE TABLE IF NOT EXISTS public.labs (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


INSERT INTO public.labs (code, name)
VALUES ('ELEC', 'Electronics Lab')
ON CONFLICT (code) DO NOTHING;


-- =========================================================
-- 2. UPDATE USER ROLES
-- =========================================================

-- Replace administrator with professor.

ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_role_check;


ALTER TABLE public.profiles
ADD CONSTRAINT profiles_role_check
CHECK (
    role IN (
        'student',
        'lab_assistant',
        'professor',
        'lab_manager'
    )
);


-- =========================================================
-- 3. ADD LAB IDENTIFICATION
-- =========================================================

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS lab_id INTEGER
REFERENCES public.labs(id)
ON DELETE RESTRICT;


ALTER TABLE public.equipment_items
ADD COLUMN IF NOT EXISTS lab_id INTEGER
REFERENCES public.labs(id)
ON DELETE RESTRICT;


ALTER TABLE public.equipment_status_history
ADD COLUMN IF NOT EXISTS lab_id INTEGER
REFERENCES public.labs(id)
ON DELETE RESTRICT;


-- Assign existing demo equipment to Electronics Lab.

UPDATE public.equipment_items
SET lab_id = (
    SELECT id
    FROM public.labs
    WHERE code = 'ELEC'
)
WHERE lab_id IS NULL;


-- Historical status records inherit the equipment's lab.

UPDATE public.equipment_status_history h
SET lab_id = i.lab_id
FROM public.equipment_items i
WHERE h.item_id = i.id
AND h.lab_id IS NULL;


-- Ensure existing profiles have a valid lab assignment.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE lab_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'Existing profiles must be assigned a lab before migration';
    END IF;
END;
$$;


ALTER TABLE public.profiles
ALTER COLUMN lab_id SET NOT NULL;


ALTER TABLE public.equipment_items
ALTER COLUMN lab_id SET NOT NULL;


ALTER TABLE public.equipment_status_history
ALTER COLUMN lab_id SET NOT NULL;


-- =========================================================
-- 4. EXPAND EQUIPMENT STATUSES
-- =========================================================

ALTER TABLE public.equipment_items
DROP CONSTRAINT IF EXISTS equipment_items_status_check;


ALTER TABLE public.equipment_items
ADD CONSTRAINT equipment_items_status_check
CHECK (
    status IN (
        'available',
        'reserved',
        'checked_out',
        'inspection_required',
        'under_maintenance',
        'retired',
        'lost',
        'overdue'
    )
);


-- =========================================================
-- 5. ADD EQUIPMENT CONDITION AND RESTRICTIONS
-- =========================================================

ALTER TABLE public.equipment_items
ADD COLUMN IF NOT EXISTS condition VARCHAR(30)
NOT NULL DEFAULT 'unknown'
CHECK (
    condition IN (
        'good',
        'damaged',
        'missing',
        'unknown'
    )
);


ALTER TABLE public.equipment_items
ADD COLUMN IF NOT EXISTS is_restricted BOOLEAN
NOT NULL DEFAULT FALSE;


-- =========================================================
-- 6. ENFORCE UNIQUE NON-NULL SERIAL NUMBERS
-- =========================================================

CREATE UNIQUE INDEX IF NOT EXISTS
equipment_items_serial_number_unique_nonnull
ON public.equipment_items (serial_number)
WHERE serial_number IS NOT NULL;


-- =========================================================
-- 7. CREATE KITS TABLE
-- =========================================================

CREATE TABLE IF NOT EXISTS public.kits (
    item_id UUID PRIMARY KEY
        REFERENCES public.equipment_items(id)
        ON DELETE RESTRICT,

    lab_id INTEGER NOT NULL
        REFERENCES public.labs(id)
        ON DELETE RESTRICT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- 8. CREATE KIT COMPONENTS TABLE
-- =========================================================

CREATE TABLE IF NOT EXISTS public.kit_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    kit_item_id UUID NOT NULL
        REFERENCES public.kits(item_id)
        ON DELETE RESTRICT,

    lab_id INTEGER NOT NULL
        REFERENCES public.labs(id)
        ON DELETE RESTRICT,

    component_name VARCHAR(150) NOT NULL,

    quantity_required INTEGER NOT NULL DEFAULT 1
        CHECK (quantity_required > 0),

    tracked_item_id UUID
        REFERENCES public.equipment_items(id)
        ON DELETE RESTRICT,

    is_required BOOLEAN NOT NULL DEFAULT TRUE,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (kit_item_id, component_name),

    CHECK (
        tracked_item_id IS NULL
        OR tracked_item_id <> kit_item_id
    )
);


-- =========================================================
-- 9. CREATE RESERVATIONS TABLE
-- =========================================================

CREATE TABLE IF NOT EXISTS public.reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    item_id UUID NOT NULL
        REFERENCES public.equipment_items(id)
        ON DELETE RESTRICT,

    borrower_id UUID NOT NULL
        REFERENCES public.profiles(id)
        ON DELETE RESTRICT,

    lab_id INTEGER NOT NULL
        REFERENCES public.labs(id)
        ON DELETE RESTRICT,

    start_at TIMESTAMPTZ NOT NULL,

    end_at TIMESTAMPTZ NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'confirmed',
                'cancelled',
                'fulfilled',
                'expired'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK (end_at > start_at)
);


-- =========================================================
-- 10. CREATE LOANS TABLE
-- =========================================================

CREATE TABLE IF NOT EXISTS public.loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    item_id UUID NOT NULL
        REFERENCES public.equipment_items(id)
        ON DELETE RESTRICT,

    borrower_id UUID NOT NULL
        REFERENCES public.profiles(id)
        ON DELETE RESTRICT,

    reservation_id UUID UNIQUE
        REFERENCES public.reservations(id)
        ON DELETE RESTRICT,

    lab_id INTEGER NOT NULL
        REFERENCES public.labs(id)
        ON DELETE RESTRICT,

    borrowed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    due_date TIMESTAMPTZ NOT NULL,

    returned_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK (due_date > borrowed_at),

    CHECK (
        returned_at IS NULL
        OR returned_at >= borrowed_at
    )
);


-- Only one active loan per equipment item.

CREATE UNIQUE INDEX IF NOT EXISTS loans_one_active_per_item
ON public.loans (item_id)
WHERE returned_at IS NULL;


-- =========================================================
-- 11. CREATE CONDITION RECORDS TABLE
-- =========================================================

CREATE TABLE IF NOT EXISTS public.condition_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    loan_id UUID NOT NULL
        REFERENCES public.loans(id)
        ON DELETE RESTRICT,

    item_id UUID NOT NULL
        REFERENCES public.equipment_items(id)
        ON DELETE RESTRICT,

    kit_component_id UUID
        REFERENCES public.kit_components(id)
        ON DELETE RESTRICT,

    lab_id INTEGER NOT NULL
        REFERENCES public.labs(id)
        ON DELETE RESTRICT,

    phase VARCHAR(20) NOT NULL
        CHECK (
            phase IN (
                'pickup',
                'return',
                'inspection'
            )
        ),

    condition_status VARCHAR(20) NOT NULL
        CHECK (
            condition_status IN (
                'good',
                'damaged',
                'missing',
                'unknown'
            )
        ),

    notes TEXT,

    recorded_by UUID
        REFERENCES public.profiles(id)
        ON DELETE SET NULL,

    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- 12. PREVENT DELETION OF HISTORICAL LOANS AND CONDITIONS
-- =========================================================

CREATE OR REPLACE FUNCTION public.prevent_historical_record_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Historical records cannot be deleted from %',
        TG_TABLE_NAME;
END;
$$;


CREATE OR REPLACE TRIGGER loans_prevent_delete
BEFORE DELETE ON public.loans
FOR EACH ROW
EXECUTE FUNCTION public.prevent_historical_record_deletion();


CREATE OR REPLACE TRIGGER condition_records_prevent_delete
BEFORE DELETE ON public.condition_records
FOR EACH ROW
EXECUTE FUNCTION public.prevent_historical_record_deletion();


-- =========================================================
-- 13. MAKE STATUS HISTORY IMMUTABLE
-- =========================================================

CREATE OR REPLACE FUNCTION public.prevent_status_history_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Equipment status history cannot be updated or deleted';
END;
$$;


CREATE OR REPLACE TRIGGER equipment_status_history_immutable
BEFORE UPDATE OR DELETE
ON public.equipment_status_history
FOR EACH ROW
EXECUTE FUNCTION public.prevent_status_history_changes();


-- =========================================================
-- 14. ENABLE RLS ON NEW TABLES
-- =========================================================

ALTER TABLE public.labs
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kits
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kit_components
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reservations
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.loans
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.condition_records
ENABLE ROW LEVEL SECURITY;


COMMIT;