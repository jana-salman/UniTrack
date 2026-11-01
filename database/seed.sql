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