-- Required before using the Loans return Saga. NOT executed by the migration task.
-- Additive: existing loans retain NULL, immutable condition/history rows are untouched.
BEGIN;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS return_operation JSONB;
COMMIT;
