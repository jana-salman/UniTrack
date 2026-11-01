CREATE TABLE IF NOT EXISTS public.equipment_categories (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name VARCHAR(100) NOT NULL,
    university_email VARCHAR(255) NOT NULL UNIQUE,
    role VARCHAR(30) NOT NULL DEFAULT 'student'
        CHECK (role IN ('student', 'lab_manager', 'lab_assistant', 'administrator')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.equipment_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    serial_number VARCHAR(100),

    category_id INTEGER NOT NULL
        REFERENCES public.equipment_categories(id)
        ON DELETE RESTRICT,

    status VARCHAR(30) NOT NULL DEFAULT 'available'
        CHECK (status IN (
            'available',
            'reserved',
            'checked_out',
            'inspection_required',
            'under_maintenance',
            'retired'
        )),

    created_by UUID
        REFERENCES public.profiles(id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.equipment_status_history (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    item_id UUID NOT NULL
        REFERENCES public.equipment_items(id)
        ON DELETE RESTRICT,

    old_status VARCHAR(30),
    new_status VARCHAR(30) NOT NULL,

    changed_by UUID
        REFERENCES public.profiles(id)
        ON DELETE SET NULL,

    reason TEXT,

    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);