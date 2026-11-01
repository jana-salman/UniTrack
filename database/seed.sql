INSERT INTO public.equipment_categories (name, description)
VALUES
    ('Electronics', 'Laptops, tablets and other electronic devices'),
    ('Laboratory Equipment', 'Instruments and tools used in university laboratories'),
    ('Audio/Visual Equipment', 'Cameras, microphones, projectors and related equipment')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.equipment_items (
    asset_code,
    name,
    description,
    serial_number,
    category_id
)
SELECT
    'UT-LAP-001',
    'Dell Latitude Laptop',
    'Demo laptop available for student borrowing',
    'DEMO-LAP-SN-001',
    id
FROM public.equipment_categories
WHERE name = 'Electronics'
ON CONFLICT (asset_code) DO NOTHING;


INSERT INTO public.equipment_items
    (asset_code, name, description, serial_number, category_id, status)
VALUES
    (
        'UT-OSC-001',
        'Digital Oscilloscope',
        'Oscilloscope for electronics laboratory experiments',
        'OSC-2026-001',
        (SELECT id FROM public.equipment_categories
         WHERE name = 'Laboratory Equipment'),
        'available'
    ),
    (
        'UT-PROJ-001',
        'Epson Projector',
        'Projector for classroom presentations',
        'PROJ-2026-001',
        (SELECT id FROM public.equipment_categories
         WHERE name = 'Audio/Visual Equipment'),
        'available'
    ),
    (
        'UT-CAM-001',
        'Canon Camera',
        'Camera awaiting equipment inspection',
        'CAM-2026-001',
        (SELECT id FROM public.equipment_categories
         WHERE name = 'Audio/Visual Equipment'),
        'inspection_required'
    ),
    (
        'UT-LAP-OLD',
        'Old HP Laptop',
        'Retired laptop no longer available for borrowing',
        'LAP-OLD-001',
        (SELECT id FROM public.equipment_categories
         WHERE name = 'Electronics'),
        'retired'
    )
ON CONFLICT (asset_code) DO NOTHING;