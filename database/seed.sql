INSERT INTO public.equipment_categories (name, description)
VALUES
    ('Electronics', 'Laptops, tablets and other electronic devices'),
    ('Laboratory Equipment', 'Instruments and tools used in university laboratories'),
    ('Audio/Visual Equipment', 'Cameras, microphones, projectors and related equipment')
ON CONFLICT (name) DO NOTHING;