-- C430PRJCT-40 / S2-09 MANUAL handover fixture. DISPOSABLE LOCAL DATABASE ONLY.
-- Never run against Supabase. Synthetic rows; fixed IDs make it safe to re-run.
-- Required psql variables (see docs/handover-s2-09.md):
--   assistant_id    = the Supabase Auth user ID you will sign in with
--   assistant_email = that account's university email (must match exactly)
-- The borrower is synthetic: the student confirms on the assistant's screen.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES
  (:'assistant_id'::uuid),
  ('00000000-0000-4000-8000-000000009902')
ON CONFLICT DO NOTHING;

INSERT INTO public.labs (id, code, name) OVERRIDING SYSTEM VALUE
VALUES (7301, 'HANDOVER-DEMO', 'Handover Demo Lab') ON CONFLICT DO NOTHING;

INSERT INTO public.equipment_categories (id, name, description) OVERRIDING SYSTEM VALUE
VALUES (7301, 'Handover Demo Equipment', 'Synthetic manual-test records') ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, full_name, university_email, role, lab_id) VALUES
  (:'assistant_id'::uuid, 'Demo Lab Assistant', lower(:'assistant_email'), 'lab_assistant', 7301),
  ('00000000-0000-4000-8000-000000009902', 'Demo Student', 'handover-demo-student@lau.edu', 'student', 7301)
ON CONFLICT DO NOTHING;

INSERT INTO public.equipment_items (id, asset_code, name, category_id, lab_id, status, condition) VALUES
  ('00000000-0000-4000-8000-000000009911', 'HO-DEMO-KIT-1', 'Demo Camera Kit (TC-3.1)', 7301, 7301, 'reserved', 'good'),
  ('00000000-0000-4000-8000-000000009912', 'HO-DEMO-KIT-2', 'Demo Camera Kit (TC-3.4)', 7301, 7301, 'reserved', 'good'),
  ('00000000-0000-4000-8000-000000009913', 'HO-DEMO-SCOPE', 'Demo Oscilloscope (TC-3.5, non-kit)', 7301, 7301, 'reserved', 'good'),
  ('00000000-0000-4000-8000-000000009914', 'HO-DEMO-KIT-3', 'Demo Camera Kit (TC-3.7)', 7301, 7301, 'reserved', 'good')
ON CONFLICT DO NOTHING;

INSERT INTO public.kits (item_id, lab_id) VALUES
  ('00000000-0000-4000-8000-000000009911', 7301),
  ('00000000-0000-4000-8000-000000009912', 7301),
  ('00000000-0000-4000-8000-000000009914', 7301)
ON CONFLICT DO NOTHING;

INSERT INTO public.kit_components (id, kit_item_id, lab_id, component_name)
SELECT ('00000000-0000-4000-8000-000000' || right(kit.id::text, 4) || 'c' || n)::uuid, kit.id, 7301, name
FROM (VALUES
  ('00000000-0000-4000-8000-000000009911'::uuid),
  ('00000000-0000-4000-8000-000000009912'::uuid),
  ('00000000-0000-4000-8000-000000009914'::uuid)) AS kit(id)
CROSS JOIN (VALUES (1, 'Charger'), (2, 'Cable'), (3, 'Battery'), (4, 'Case'), (5, 'Tripod')) AS component(n, name)
ON CONFLICT DO NOTHING;

INSERT INTO public.reservations (id, item_id, borrower_id, lab_id, start_at, end_at, status) VALUES
  ('00000000-0000-4000-8000-000000009921', '00000000-0000-4000-8000-000000009911', '00000000-0000-4000-8000-000000009902', 7301, now() - interval '1 hour', now() + interval '7 days', 'confirmed'),
  ('00000000-0000-4000-8000-000000009922', '00000000-0000-4000-8000-000000009912', '00000000-0000-4000-8000-000000009902', 7301, now() - interval '1 hour', now() + interval '7 days', 'confirmed'),
  ('00000000-0000-4000-8000-000000009923', '00000000-0000-4000-8000-000000009913', '00000000-0000-4000-8000-000000009902', 7301, now() - interval '1 hour', now() + interval '7 days', 'confirmed'),
  ('00000000-0000-4000-8000-000000009924', '00000000-0000-4000-8000-000000009914', '00000000-0000-4000-8000-000000009902', 7301, now() - interval '1 hour', now() + interval '7 days', 'confirmed')
ON CONFLICT DO NOTHING;

COMMIT;

SELECT r.id AS reservation_id, i.asset_code, i.name, i.status AS equipment_status
FROM public.reservations r JOIN public.equipment_items i ON i.id = r.item_id
WHERE r.lab_id = 7301 ORDER BY i.asset_code;
