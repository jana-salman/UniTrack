-- =========================================================
-- S2-13: Custody Record Protection
-- =========================================================

BEGIN;

-- Prevent modifications to existing condition records.
-- INSERT remains allowed for pickup and return inspections.
-- DELETE is already blocked by migration 002.

CREATE OR REPLACE FUNCTION public.prevent_condition_record_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Condition records cannot be updated';
END;
$$;

CREATE OR REPLACE TRIGGER condition_records_prevent_update
BEFORE UPDATE ON public.condition_records
FOR EACH ROW
EXECUTE FUNCTION public.prevent_condition_record_updates();

-- =========================================================
-- Protect original loan information
-- =========================================================

CREATE OR REPLACE FUNCTION public.prevent_unauthorized_loan_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Original loan details must remain unchanged.
    IF ROW(
        NEW.id,
        NEW.item_id,
        NEW.borrower_id,
        NEW.reservation_id,
        NEW.lab_id,
        NEW.borrowed_at,
        NEW.due_date,
        NEW.created_at
    ) IS DISTINCT FROM ROW(
        OLD.id,
        OLD.item_id,
        OLD.borrower_id,
        OLD.reservation_id,
        OLD.lab_id,
        OLD.borrowed_at,
        OLD.due_date,
        OLD.created_at
    ) THEN
        RAISE EXCEPTION
            'Original loan information cannot be modified';
    END IF;
    -- A return timestamp can only be recorded once.
    -- Once recorded, it cannot be changed or cleared.
    IF OLD.returned_at IS NOT NULL
       AND NEW.returned_at IS DISTINCT FROM OLD.returned_at
    THEN
        RAISE EXCEPTION
            'Loan return timestamp cannot be changed once recorded';
    END IF;
    -- Protect the return operation's identity and original details.
    IF NEW.return_operation IS DISTINCT FROM OLD.return_operation THEN

        -- The operation must be a JSON object.
        IF NEW.return_operation IS NULL
           OR jsonb_typeof(NEW.return_operation) <> 'object'
        THEN
            RAISE EXCEPTION
                'Return operation cannot be cleared or invalid';
        END IF;

        IF OLD.return_operation IS NULL THEN

            -- New return operations must begin in the planned state.
            IF NEW.return_operation->>'state' IS DISTINCT FROM 'planned' THEN
                RAISE EXCEPTION
                    'Return operation must start in the planned state';
            END IF;
            -- A new return operation cannot be started
            -- for a loan that has already been returned.
            IF OLD.returned_at IS NOT NULL THEN
                RAISE EXCEPTION
                    'Cannot start a return operation for a returned loan';
            END IF;

            -- Validate the new operation's identity and outcome.
            IF NOT COALESCE(
                (
                    NEW.return_operation->>'fingerprint'
                        ~ '^[a-f0-9]{64}$'

                    AND NEW.return_operation->>'key'
                        ~ '^return:[a-f0-9-]{36}$'

                    AND length(NEW.return_operation->>'actor') > 0

                    AND NEW.return_operation->>'previous'
                        IN ('checked_out', 'overdue')

                    AND jsonb_typeof(
                        NEW.return_operation->'result'
                    ) = 'object'

                    AND NEW.return_operation->'result'->>'loanId'
                        = NEW.id::text

                    AND NEW.return_operation->'result'->>'status'
                        IN ('available', 'reserved', 'inspection_required')

                    AND jsonb_typeof(
                        NEW.return_operation->'result'->'isLate'
                    ) = 'boolean'

                    AND jsonb_typeof(
                        NEW.return_operation->'result'->'returnedAt'
                    ) = 'string'
                ),
                FALSE
            ) THEN
                RAISE EXCEPTION
                    'Invalid return operation information';
            END IF;
        ELSE

            -- Existing operations must retain their original details.
            -- Only state and attempt may change.
            IF (
                NEW.return_operation - 'state' - 'attempt'
            ) IS DISTINCT FROM (
                OLD.return_operation - 'state' - 'attempt'
            ) THEN
                RAISE EXCEPTION
                    'Original return operation details cannot be modified';
            END IF;

        END IF;
    END IF;
    -- Allow only valid return-operation state transitions.
    IF OLD.return_operation IS NOT NULL
       AND NEW.return_operation IS DISTINCT FROM OLD.return_operation
    THEN
        IF NOT COALESCE(
            (
                -- Repeated persistence of the same state.
                OLD.return_operation->>'state'
                    = NEW.return_operation->>'state'

                -- Normal return.
                OR (
                    OLD.return_operation->>'state' = 'planned'
                    AND NEW.return_operation->>'state' = 'applied'
                )
                OR (
                    OLD.return_operation->>'state' = 'applied'
                    AND NEW.return_operation->>'state' = 'completed'
                )

                -- Failure recovery.
                OR (
                    OLD.return_operation->>'state' = 'applied'
                    AND NEW.return_operation->>'state' = 'compensating'
                )
                OR (
                    OLD.return_operation->>'state' = 'compensating'
                    AND NEW.return_operation->>'state' = 'compensated'
                )
                OR (
                    OLD.return_operation->>'state' = 'compensated'
                    AND NEW.return_operation->>'state' = 'planned'
                )
            ),
            FALSE
        ) THEN
            RAISE EXCEPTION
                'Invalid return operation state transition';
        END IF;
    END IF;
    -- Restrict the return operation retry counter.
    IF NEW.return_operation IS DISTINCT FROM OLD.return_operation THEN

        -- Attempt must be a non-negative safe integer.
        IF jsonb_typeof(NEW.return_operation->'attempt')
               IS DISTINCT FROM 'number'
           OR (NEW.return_operation->>'attempt')
               !~ '^(0|[1-9][0-9]*)$'
        THEN
            RAISE EXCEPTION
                'Invalid return operation attempt number';
        END IF;

        IF (NEW.return_operation->>'attempt')::numeric
               >= 9007199254740991
        THEN
            RAISE EXCEPTION
                'Return operation attempt exceeds allowed range';
        END IF;

        IF OLD.return_operation IS NULL THEN

            -- A new return operation must start at attempt zero.
            IF (NEW.return_operation->>'attempt')::numeric <> 0 THEN
                RAISE EXCEPTION
                    'New return operations must start at attempt zero';
            END IF;

        ELSIF OLD.return_operation->>'state' = 'compensated'
              AND NEW.return_operation->>'state' = 'planned'
        THEN

            -- Only a compensated retry increments the attempt.
            IF (NEW.return_operation->>'attempt')::numeric
               <> (OLD.return_operation->>'attempt')::numeric + 1
            THEN
                RAISE EXCEPTION
                    'Retry attempt must increase by exactly one';
            END IF;

        ELSIF NEW.return_operation->>'attempt'
              IS DISTINCT FROM OLD.return_operation->>'attempt'
        THEN

            -- All other transitions must preserve the attempt.
            RAISE EXCEPTION
                'Return operation attempt cannot change';

        END IF;
    END IF;
    -- Step 1: The Loans Service records the return timestamp
    -- while the operation is still in the applied state.

    IF OLD.returned_at IS NULL
       AND NEW.returned_at IS NOT NULL
    THEN
        IF OLD.return_operation IS NULL
           OR OLD.return_operation->>'state'
                IS DISTINCT FROM 'applied'
           OR NEW.return_operation->>'state'
                IS DISTINCT FROM 'applied'
        THEN
            RAISE EXCEPTION
                'Return timestamp requires an applied return operation';
        END IF;

        IF NEW.return_operation->'result'->>'loanId'
               IS DISTINCT FROM NEW.id::text
           OR NEW.return_operation->'result'->>'returnedAt'
               IS NULL
           OR (
               NEW.return_operation->'result'->>'returnedAt'
           )::timestamptz IS DISTINCT FROM NEW.returned_at
        THEN
            RAISE EXCEPTION
                'Return timestamp does not match return operation';
        END IF;
    END IF;

    -- Step 2: The service subsequently marks the operation
    -- completed within the same return transaction.

    IF OLD.return_operation->>'state'
           IS DISTINCT FROM 'completed'
       AND NEW.return_operation->>'state' = 'completed'
    THEN
        IF OLD.return_operation->>'state'
               IS DISTINCT FROM 'applied'
           OR NEW.returned_at IS NULL
           OR NEW.return_operation->'result'->>'returnedAt'
               IS NULL
           OR (
               NEW.return_operation->'result'->>'returnedAt'
           )::timestamptz IS DISTINCT FROM NEW.returned_at
        THEN
            RAISE EXCEPTION
                'Completed return requires a matching return timestamp';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER loans_protect_updates
BEFORE UPDATE ON public.loans
FOR EACH ROW
EXECUTE FUNCTION public.prevent_unauthorized_loan_updates();

-- =========================================================
-- Restrict Loans Service UPDATE permissions
-- =========================================================

-- Remove unrestricted UPDATE access granted by migration 006.
REVOKE UPDATE ON public.loans
FROM unitrack_loans_service;

-- Allow only the fields required by the return workflow.
GRANT UPDATE (returned_at, return_operation)
ON public.loans
TO unitrack_loans_service;


COMMIT;