-- ==========================================
-- UniTrack Demo Data
-- ==========================================
BEGIN;
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

-- 1. Create demo categories if they don't already exist

INSERT INTO public.equipment_categories (name, description)
VALUES
    ('Development Boards', 'FPGA and microcontroller boards'),
    ('Measurement Instruments', 'Oscilloscopes and measurement tools'),
    ('Lab Accessories', 'Electronics tools and accessories'),
    ('Equipment Kits', 'Complete teaching equipment kits')
ON CONFLICT (name) DO NOTHING;


-- 2. Add 15 individual items and 3 kit items

WITH demo_items (asset_code, name, description, category_name) AS (
    VALUES
    ('DEMO-ELEC-001', 'FPGA Development Board 1', 'FPGA board for digital design', 'Development Boards'),
    ('DEMO-ELEC-002', 'FPGA Development Board 2', 'FPGA board for digital design', 'Development Boards'),
    ('DEMO-ELEC-003', 'Arduino Uno Board 1', 'Arduino microcontroller board', 'Development Boards'),
    ('DEMO-ELEC-004', 'ESP32 Development Board', 'WiFi-enabled microcontroller', 'Development Boards'),
    ('DEMO-ELEC-005', 'Raspberry Pi 5', 'Single-board computer', 'Development Boards'),

    ('DEMO-ELEC-006', 'Digital Oscilloscope 1', 'Two-channel digital oscilloscope', 'Measurement Instruments'),
    ('DEMO-ELEC-007', 'Digital Oscilloscope 2', 'Two-channel digital oscilloscope', 'Measurement Instruments'),
    ('DEMO-ELEC-008', 'Digital Multimeter 1', 'Electronic measurement device', 'Measurement Instruments'),
    ('DEMO-ELEC-009', 'Function Generator 1', 'Electronic signal generator', 'Measurement Instruments'),

    ('DEMO-ELEC-010', 'Bench Power Supply', 'Adjustable laboratory power supply', 'Lab Accessories'),
    ('DEMO-ELEC-011', 'Logic Analyzer', 'Digital signal analysis tool', 'Lab Accessories'),
    ('DEMO-ELEC-012', 'Soldering Station', 'Temperature-controlled soldering station', 'Lab Accessories'),
    ('DEMO-ELEC-013', 'Temperature Sensor Module', 'Electronic temperature sensor', 'Lab Accessories'),
    ('DEMO-ELEC-014', 'DC Motor Controller', 'Motor control development module', 'Lab Accessories'),
    ('DEMO-ELEC-015', 'Breadboard Set', 'Breadboard and jumper wires', 'Lab Accessories'),

    ('DEMO-KIT-001', 'Arduino Starter Kit', 'Complete Arduino learning kit', 'Equipment Kits'),
    ('DEMO-KIT-002', 'Raspberry Pi Robotics Kit', 'Robotics development kit', 'Equipment Kits'),
    ('DEMO-KIT-003', 'FPGA Digital Logic Kit', 'Digital logic learning kit', 'Equipment Kits')
)

INSERT INTO public.equipment_items (
    asset_code,
    name,
    description,
    category_id,
    lab_id,
    status,
    condition,
    is_restricted
)
SELECT
    d.asset_code,
    d.name,
    d.description,
    c.id,
    l.id,
    'available',
    'good',
    FALSE
FROM demo_items d
JOIN public.equipment_categories c
    ON c.name = d.category_name
JOIN public.labs l
    ON l.code = 'ELEC'
ON CONFLICT (asset_code) DO NOTHING;


-- 3. Register the three kits

INSERT INTO public.kits (
    item_id,
    lab_id
)
SELECT
    e.id,
    e.lab_id
FROM public.equipment_items e
WHERE e.asset_code IN (
    'DEMO-KIT-001',
    'DEMO-KIT-002',
    'DEMO-KIT-003'
)
AND NOT EXISTS (
    SELECT 1
    FROM public.kits k
    WHERE k.item_id = e.id
);


-- 4. Add five components to each kit

WITH demo_components (
    kit_code,
    component_name,
    quantity_required
) AS (
    VALUES
    ('DEMO-KIT-001', 'Arduino Uno Board', 1),
    ('DEMO-KIT-001', 'Breadboard', 1),
    ('DEMO-KIT-001', 'USB Cable', 1),
    ('DEMO-KIT-001', 'Jumper Wires', 20),
    ('DEMO-KIT-001', 'LED and Resistor Pack', 1),

    ('DEMO-KIT-002', 'Raspberry Pi Board', 1),
    ('DEMO-KIT-002', 'Motor Controller', 1),
    ('DEMO-KIT-002', 'DC Motors', 2),
    ('DEMO-KIT-002', 'Wheels and Chassis', 1),
    ('DEMO-KIT-002', 'Power Adapter', 1),

    ('DEMO-KIT-003', 'FPGA Board', 1),
    ('DEMO-KIT-003', 'Programming Cable', 1),
    ('DEMO-KIT-003', 'Seven-Segment Display', 1),
    ('DEMO-KIT-003', 'Switch and LED Module', 1),
    ('DEMO-KIT-003', 'Power Adapter', 1)
)

INSERT INTO public.kit_components (
    kit_item_id,
    lab_id,
    component_name,
    quantity_required,
    is_required,
    is_active
)
SELECT
    e.id,
    e.lab_id,
    d.component_name,
    d.quantity_required,
    TRUE,
    TRUE
FROM demo_components d
JOIN public.equipment_items e
    ON e.asset_code = d.kit_code
JOIN public.kits k
    ON k.item_id = e.id
WHERE NOT EXISTS (
    SELECT 1
    FROM public.kit_components kc
    WHERE kc.kit_item_id = e.id
      AND kc.component_name = d.component_name
);

COMMIT;