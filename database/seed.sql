-- ==========================================
-- UniTrack Demo Data
-- ==========================================

-- Initial laboratory

INSERT INTO public.labs (code, name)
VALUES ('ELEC', 'Electronics Lab')
ON CONFLICT (code) DO NOTHING;


-- ==========================================
-- EQUIPMENT CATEGORIES
-- ==========================================

INSERT INTO public.equipment_categories (name, description)
VALUES
    (
        'Electronics',
        'Laptops and electronic devices'
    ),
    (
        'Laboratory Equipment',
        'Equipment for laboratory experiments'
    ),
    (
        'Audio/Visual Equipment',
        'Cameras and presentation equipment'
    )
ON CONFLICT (name) DO NOTHING;


-- ==========================================
-- DEMO EQUIPMENT ITEMS
-- ==========================================

INSERT INTO public.equipment_items (
    asset_code,
    name,
    description,
    serial_number,
    category_id,
    lab_id,
    status,
    condition,
    is_restricted
)
VALUES
    (
        'UT-LAP-001',
        'Dell Latitude Laptop',
        'Demo laptop available for student borrowing',
        'DEMO-LAP-SN-001',

        (
            SELECT id
            FROM public.equipment_categories
            WHERE name = 'Electronics'
        ),

        (
            SELECT id
            FROM public.labs
            WHERE code = 'ELEC'
        ),

        'available',
        'unknown',
        FALSE
    ),

    (
        'UT-OSC-001',
        'Digital Oscilloscope',
        'Oscilloscope for electronics laboratory experiments',
        'OSC-2026-001',

        (
            SELECT id
            FROM public.equipment_categories
            WHERE name = 'Laboratory Equipment'
        ),

        (
            SELECT id
            FROM public.labs
            WHERE code = 'ELEC'
        ),

        'available',
        'unknown',
        FALSE
    ),

    (
        'UT-PROJ-001',
        'Epson Projector',
        'Projector for classroom presentations',
        'PROJ-2026-001',

        (
            SELECT id
            FROM public.equipment_categories
            WHERE name = 'Audio/Visual Equipment'
        ),

        (
            SELECT id
            FROM public.labs
            WHERE code = 'ELEC'
        ),

        'available',
        'unknown',
        FALSE
    ),

    (
        'UT-CAM-001',
        'Canon Camera',
        'Camera awaiting equipment inspection',
        'CAM-2026-001',

        (
            SELECT id
            FROM public.equipment_categories
            WHERE name = 'Audio/Visual Equipment'
        ),

        (
            SELECT id
            FROM public.labs
            WHERE code = 'ELEC'
        ),

        'inspection_required',
        'unknown',
        FALSE
    ),

    (
        'UT-LAP-OLD',
        'Old HP Laptop',
        'Retired laptop no longer available for borrowing',
        'LAP-OLD-001',

        (
            SELECT id
            FROM public.equipment_categories
            WHERE name = 'Electronics'
        ),

        (
            SELECT id
            FROM public.labs
            WHERE code = 'ELEC'
        ),

        'retired',
        'unknown',
        FALSE
    )

ON CONFLICT (asset_code) DO NOTHING;