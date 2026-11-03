-- UniTrack Complete Database Schema
-- Jira: C430PRJCT-21 (S1-04)
-- Design draft: requires Product Owner approval.
--
-- This file describes the complete database design.
-- Do not execute it against the existing Supabase database.
-- Existing tables must be updated using a separate migration.

-- ==========================================
-- 1. LABS
-- ==========================================

CREATE TABLE IF NOT EXISTS public.labs (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- 2. EQUIPMENT CATEGORIES
-- ==========================================

CREATE TABLE IF NOT EXISTS public.equipment_categories (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- 3. USER PROFILES
-- ==========================================

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    full_name VARCHAR(100) NOT NULL,

    university_email VARCHAR(255) NOT NULL UNIQUE,

    role VARCHAR(30) NOT NULL DEFAULT 'student'
        CHECK (role IN (
            'student',
            'lab_assistant',
            'professor',
            'lab_manager'
        )),

    lab_id INTEGER NOT NULL
        REFERENCES public.labs(id)
        ON DELETE RESTRICT,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- 4. EQUIPMENT ITEMS
-- ==========================================

CREATE TABLE IF NOT EXISTS public.equipment_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    asset_code VARCHAR(50) NOT NULL UNIQUE,

    name VARCHAR(150) NOT NULL,

    description TEXT,

    serial_number VARCHAR(100) UNIQUE,

condition VARCHAR(30) NOT NULL DEFAULT 'unknown'
    CHECK (condition IN (
        'good',
        'damaged',
        'missing',
        'unknown'
    )),

is_restricted BOOLEAN NOT NULL DEFAULT FALSE,

    category_id INTEGER NOT NULL
        REFERENCES public.equipment_categories(id)
        ON DELETE RESTRICT,

    lab_id INTEGER NOT NULL
        REFERENCES public.labs(id)
        ON DELETE RESTRICT,

    status VARCHAR(30) NOT NULL DEFAULT 'available'
    CHECK (status IN (
        'available',
        'reserved',
        'checked_out',
        'inspection_required',
        'under_maintenance',
        'retired',
        'lost',
        'overdue'
    )),

    created_by UUID
        REFERENCES public.profiles(id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- 5. KITS
-- ==========================================

-- A kit is also an equipment item.
-- Its item_id references equipment_items.id.
-- Therefore, a kit has its own asset code,
-- physical status, category, and QR code.

CREATE TABLE IF NOT EXISTS public.kits (
    item_id UUID PRIMARY KEY
        REFERENCES public.equipment_items(id)
        ON DELETE RESTRICT,

    lab_id INTEGER NOT NULL
        REFERENCES public.labs(id)
        ON DELETE RESTRICT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- 6. KIT COMPONENTS
-- ==========================================

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


-- ==========================================
-- 7. RESERVATIONS
-- ==========================================

-- A future reservation does NOT automatically
-- change the item's current physical status.

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
        CHECK (status IN (
            'pending',
            'confirmed',
            'cancelled',
            'fulfilled',
            'expired'
        )),

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK (end_at > start_at)
);


-- ==========================================
-- 8. LOANS
-- ==========================================

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


-- Prevent more than one active loan for an item.

CREATE UNIQUE INDEX IF NOT EXISTS loans_one_active_per_item
ON public.loans (item_id)
WHERE returned_at IS NULL;


-- ==========================================
-- 9. CONDITION RECORDS
-- ==========================================

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
        CHECK (phase IN (
            'pickup',
            'return',
            'inspection'
        )),

    condition_status VARCHAR(20) NOT NULL
        CHECK (condition_status IN (
            'good',
            'damaged',
            'missing',
            'unknown'
        )),

    notes TEXT,

    recorded_by UUID
        REFERENCES public.profiles(id)
        ON DELETE SET NULL,

    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- 10. EQUIPMENT STATUS HISTORY
-- ==========================================

CREATE TABLE IF NOT EXISTS public.equipment_status_history (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    item_id UUID NOT NULL
        REFERENCES public.equipment_items(id)
        ON DELETE RESTRICT,

    lab_id INTEGER NOT NULL
        REFERENCES public.labs(id)
        ON DELETE RESTRICT,

    old_status VARCHAR(30),

    new_status VARCHAR(30) NOT NULL,

    changed_by UUID
        REFERENCES public.profiles(id)
        ON DELETE SET NULL,

    reason TEXT,

    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- 11. AUTOMATIC UPDATED_AT
-- ==========================================

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
-- 12. PROTECT HISTORICAL RECORDS
-- ==========================================

CREATE OR REPLACE FUNCTION public.prevent_historical_record_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Cannot delete historical records from %',
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


-- ==========================================
-- 13. ENABLE ROW LEVEL SECURITY
-- ==========================================

-- NH will implement the necessary RLS policies.

ALTER TABLE public.labs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.equipment_categories ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.equipment_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kits ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kit_components ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.condition_records ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.equipment_status_history ENABLE ROW LEVEL SECURITY;