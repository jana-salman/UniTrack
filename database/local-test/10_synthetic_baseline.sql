-- Fixed, synthetic records for disposable migration tests. No values come from
-- Supabase or a developer environment.
BEGIN;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');

INSERT INTO public.labs (id, code, name)
OVERRIDING SYSTEM VALUE
VALUES (7001, 'LOCAL-TEST', 'Disposable Migration Test Lab');

INSERT INTO public.equipment_categories (id, name, description)
OVERRIDING SYSTEM VALUE
VALUES (7101, 'Local Test Equipment', 'Synthetic records only');

INSERT INTO public.profiles
  (id, full_name, university_email, role, lab_id)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    'Local Test Assistant',
    'local-assistant@lau.edu',
    'lab_assistant',
    7001
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'Local Test Borrower',
    'local-borrower@lau.edu',
    'student',
    7001
  );

INSERT INTO public.equipment_items
  (id, asset_code, name, category_id, lab_id, status, condition)
VALUES
  (
    '00000000-0000-4000-8000-000000000101',
    'LOCAL-MIGRATION-ITEM',
    'Migration Trigger Test Item',
    7101,
    7001,
    'available',
    'good'
  ),
  (
    '00000000-0000-4000-8000-000000000102',
    'LOCAL-RETURN-ITEM',
    'Return Saga Test Item',
    7101,
    7001,
    'checked_out',
    'good'
  );

-- This pre-003 keyed receipt proves migration 003 is additive and does not
-- backfill immutable history.
INSERT INTO public.equipment_status_history
  (item_id, lab_id, old_status, new_status, changed_by, reason, request_key)
VALUES
  (
    '00000000-0000-4000-8000-000000000101',
    7001,
    'available',
    'available',
    '00000000-0000-4000-8000-000000000001',
    'Synthetic legacy keyed receipt',
    'local:legacy:receipt'
  );

INSERT INTO public.loans
  (id, item_id, borrower_id, lab_id, borrowed_at, due_date)
VALUES
  (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000002',
    7001,
    '2026-01-01T00:00:00Z',
    '2099-01-01T00:00:00Z'
  );

INSERT INTO public.condition_records
  (id, loan_id, item_id, lab_id, phase, condition_status, notes, recorded_by)
VALUES
  (
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000102',
    7001,
    'pickup',
    'good',
    'Synthetic pickup record',
    '00000000-0000-4000-8000-000000000001'
  );

COMMIT;
