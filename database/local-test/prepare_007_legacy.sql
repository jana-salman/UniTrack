-- Seed a legacy returned loan before migration 007 is applied. The custody
-- migration must leave this historical row intact even though it predates the
-- return_operation protocol introduced for new Returns.

INSERT INTO public.loans
    (id, item_id, borrower_id, lab_id, borrowed_at, due_date, returned_at)
VALUES
    (
        '00000000-0000-4000-8000-000000000299',
        '00000000-0000-4000-8000-000000000101',
        '00000000-0000-4000-8000-000000000002',
        7001,
        '2026-01-01T00:00:00Z',
        '2026-02-01T00:00:00Z',
        '2026-01-15T00:00:00Z'
    );
