
-- =========================================================
-- S2-13: Custody Record Protection Tests
-- Disposable local PostgreSQL database only
-- =========================================================

BEGIN;

DO $$
BEGIN

    -- TEST 1: Updating an existing condition record must fail.
    BEGIN
        UPDATE public.condition_records
        SET notes = 'Unauthorized modification'
        WHERE id = '00000000-0000-4000-8000-000000000301';

        RAISE EXCEPTION
            'TEST FAILED: Condition record UPDATE was allowed';

    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'Condition records cannot be updated' THEN
            RAISE;
        END IF;
    END;

    -- TEST 2: Modifying original loan information must fail.
    BEGIN
        UPDATE public.loans
        SET due_date = due_date + INTERVAL '1 day'
        WHERE id = '00000000-0000-4000-8000-000000000201';

        RAISE EXCEPTION
            'TEST FAILED: Original loan information was modified';

    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'Original loan information cannot be modified' THEN
            RAISE;
        END IF;
    END;

    -- TEST 3: Deleting a historical loan must fail.
    BEGIN
        DELETE FROM public.loans
        WHERE id = '00000000-0000-4000-8000-000000000201';

        RAISE EXCEPTION
            'TEST FAILED: Historical loan DELETE was allowed';

    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'Cannot delete historical records from loans' THEN
            RAISE;
        END IF;
    END;

    -- TEST 4: Deleting a condition record must fail.
    BEGIN
        DELETE FROM public.condition_records
        WHERE id = '00000000-0000-4000-8000-000000000301';

        RAISE EXCEPTION
            'TEST FAILED: Condition record DELETE was allowed';

    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'Cannot delete historical records from condition_records' THEN
            RAISE;
        END IF;
    END;
    -- TEST 5: Cannot mark a loan as returned
    -- without a valid return operation.
    BEGIN
        UPDATE public.loans
        SET returned_at = NOW()
        WHERE id = '00000000-0000-4000-8000-000000000201';

        RAISE EXCEPTION
            'TEST FAILED: Unauthorized return timestamp was allowed';

    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'Return timestamp requires an applied return operation' THEN
            RAISE;
        END IF;
    END;
    -- TEST 6: Cannot create an invalid return operation.
    BEGIN
        UPDATE public.loans
        SET return_operation = '{
            "state": "planned",
            "attempt": 0
        }'::jsonb
        WHERE id = '00000000-0000-4000-8000-000000000201';

        RAISE EXCEPTION
            'TEST FAILED: Invalid return operation was allowed';

    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'Invalid return operation information' THEN
            RAISE;
        END IF;
    END;
        -- TEST 7: Cannot skip an intermediate return state.
    BEGIN

        -- First, create a valid planned return operation.
        UPDATE public.loans
        SET return_operation = jsonb_build_object(
            'fingerprint', repeat('a', 64),
            'key', 'return:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'attempt', 0,
            'actor', '00000000-0000-4000-8000-000000000001',
            'previous', 'checked_out',
            'state', 'planned',
            'result', jsonb_build_object(
                'loanId', id::text,
                'status', 'available',
                'isLate', false,
                'returnedAt', '2026-11-19T12:00:00.000Z'
            )
        )
        WHERE id = '00000000-0000-4000-8000-000000000201';

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'TEST SETUP FAILED: Loan not found';
        END IF;

        -- Try to skip directly from planned to completed.
        UPDATE public.loans
        SET return_operation = jsonb_set(
            return_operation,
            '{state}',
            '"completed"'::jsonb
        )
        WHERE id = '00000000-0000-4000-8000-000000000201';

        RAISE EXCEPTION
            'TEST FAILED: Invalid state transition was allowed';

    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'Invalid return operation state transition' THEN
            RAISE;
        END IF;
    END;
    -- TEST 8: Cannot arbitrarily change the retry counter.
    BEGIN

        -- First, create a valid planned return operation.
        UPDATE public.loans
        SET return_operation = jsonb_build_object(
            'fingerprint', repeat('a', 64),
            'key', 'return:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'attempt', 0,
            'actor', '00000000-0000-4000-8000-000000000001',
            'previous', 'checked_out',
            'state', 'planned',
            'result', jsonb_build_object(
                'loanId', id::text,
                'status', 'available',
                'isLate', false,
                'returnedAt', '2026-11-19T12:00:00.000Z'
            )
        )
        WHERE id = '00000000-0000-4000-8000-000000000201';

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'TEST SETUP FAILED: Loan not found';
        END IF;

        -- Attempt to change the counter without compensation.
        UPDATE public.loans
        SET return_operation = jsonb_set(
            return_operation,
            '{attempt}',
            '2'::jsonb
        )
        WHERE id = '00000000-0000-4000-8000-000000000201';

        RAISE EXCEPTION
            'TEST FAILED: Invalid retry counter was allowed';

    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'Return operation attempt cannot change' THEN
            RAISE;
        END IF;
    END;

    -- TEST 9: A legitimate compensation and retry must work.
    BEGIN
        -- Create the original planned return operation.
        UPDATE public.loans
        SET return_operation = jsonb_build_object(
            'fingerprint', repeat('a', 64),
            'key', 'return:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'attempt', 0,
            'actor', '00000000-0000-4000-8000-000000000001',
            'previous', 'checked_out',
            'state', 'planned',
            'result', jsonb_build_object(
                'loanId', id::text,
                'status', 'available',
                'isLate', false,
                'returnedAt', '2026-11-19T12:00:00.000Z'
            )
        )
        WHERE id = '00000000-0000-4000-8000-000000000201';

        IF NOT FOUND THEN
            RAISE EXCEPTION 'TEST 9 FAILED: Loan not found';
        END IF;

        -- Simulate the legitimate recovery state transitions.
        UPDATE public.loans
        SET return_operation = jsonb_set(
            return_operation, '{state}', '"applied"'
        )
        WHERE id = '00000000-0000-4000-8000-000000000201';

        UPDATE public.loans
        SET return_operation = jsonb_set(
            return_operation, '{state}', '"compensating"'
        )
        WHERE id = '00000000-0000-4000-8000-000000000201';

        UPDATE public.loans
        SET return_operation = jsonb_set(
            return_operation, '{state}', '"compensated"'
        )
        WHERE id = '00000000-0000-4000-8000-000000000201';

        -- Restart the operation with attempt incremented to 1.
        UPDATE public.loans
        SET return_operation = jsonb_set(
            jsonb_set(
                return_operation, '{state}', '"planned"'
            ),
            '{attempt}', '1'
        )
        WHERE id = '00000000-0000-4000-8000-000000000201';

        IF NOT EXISTS (
            SELECT 1
            FROM public.loans
            WHERE id = '00000000-0000-4000-8000-000000000201'
              AND return_operation->>'state' = 'planned'
              AND return_operation->>'attempt' = '1'
        ) THEN
            RAISE EXCEPTION
                'TEST 9 FAILED: Valid retry was not recorded';
        END IF;

        RAISE NOTICE
            'PASS: Valid compensation and retry transitions';

        -- Intentionally roll back this test's temporary changes.
        RAISE EXCEPTION 'TEST_9_ROLLBACK';

    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'TEST_9_ROLLBACK' THEN
            RAISE;
        END IF;
    END;

    -- TEST 10: A completed return must remain immutable.
    BEGIN
        -- Create a valid planned return operation.
        UPDATE public.loans
        SET return_operation = jsonb_build_object(
            'fingerprint', repeat('a', 64),
            'key', 'return:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'attempt', 0,
            'actor', '00000000-0000-4000-8000-000000000001',
            'previous', 'checked_out',
            'state', 'planned',
            'result', jsonb_build_object(
                'loanId', id::text,
                'status', 'available',
                'isLate', false,
                'returnedAt', '2026-11-19T12:00:00.000Z'
            )
        )
        WHERE id = '00000000-0000-4000-8000-000000000201';

        IF NOT FOUND THEN
            RAISE EXCEPTION 'TEST 10 FAILED: Loan not found';
        END IF;

        -- Progress through a normal return.
        UPDATE public.loans
        SET return_operation = jsonb_set(
            return_operation, '{state}', '"applied"'
        )
        WHERE id = '00000000-0000-4000-8000-000000000201';

        UPDATE public.loans
        SET returned_at = '2026-11-19T12:00:00.000Z'::timestamptz
        WHERE id = '00000000-0000-4000-8000-000000000201';

        UPDATE public.loans
        SET return_operation = jsonb_set(
            return_operation, '{state}', '"completed"'
        )
        WHERE id = '00000000-0000-4000-8000-000000000201';

        -- Check that the completed return was recorded.
        IF NOT EXISTS (
            SELECT 1 FROM public.loans
            WHERE id = '00000000-0000-4000-8000-000000000201'
              AND return_operation->>'state' = 'completed'
              AND returned_at =
                  '2026-11-19T12:00:00.000Z'::timestamptz
        ) THEN
            RAISE EXCEPTION
                'TEST 10 FAILED: Valid completion was not recorded';
        END IF;

        -- Changing the return timestamp must fail.
        BEGIN
            UPDATE public.loans
            SET returned_at = returned_at + INTERVAL '1 hour'
            WHERE id = '00000000-0000-4000-8000-000000000201';

            RAISE EXCEPTION
                'TEST 10 FAILED: Return timestamp was modified';

        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM <>
               'Loan return timestamp cannot be changed once recorded'
            THEN
                RAISE;
            END IF;
        END;

        -- Reopening a completed return must fail.
        BEGIN
            UPDATE public.loans
            SET return_operation = jsonb_set(
                return_operation, '{state}', '"planned"'
            )
            WHERE id = '00000000-0000-4000-8000-000000000201';

            RAISE EXCEPTION
                'TEST 10 FAILED: Completed return was reopened';

        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM <> 'Invalid return operation state transition'
            THEN
                RAISE;
            END IF;
        END;

        RAISE NOTICE
            'PASS: Valid completion and completed-return immutability';

        -- Roll back temporary test changes.
        RAISE EXCEPTION 'TEST_10_ROLLBACK';

    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'TEST_10_ROLLBACK' THEN
            RAISE;
        END IF;
    END;



    RAISE NOTICE
        'PASS: Condition record and loan history updates were blocked';

END;
$$;


-- TEST 11: Verify restricted Loans Service UPDATE permissions.

DO $$
BEGIN
    -- Only the two return-related columns should be writable.
    IF NOT has_column_privilege(
        'unitrack_loans_service',
        'public.loans',
        'returned_at',
        'UPDATE'
    )
    OR NOT has_column_privilege(
        'unitrack_loans_service',
        'public.loans',
        'return_operation',
        'UPDATE'
    ) THEN
        RAISE EXCEPTION
            'TEST 11 FAILED: Required return permissions are missing';
    END IF;

    -- Unrestricted table-level UPDATE must be removed.
    IF has_table_privilege(
        'unitrack_loans_service',
        'public.loans',
        'UPDATE'
    ) THEN
        RAISE EXCEPTION
            'TEST 11 FAILED: Unrestricted loan UPDATE is allowed';
    END IF;

    -- Original loan information must not be writable.
    IF has_column_privilege(
        'unitrack_loans_service',
        'public.loans',
        'borrower_id',
        'UPDATE'
    )
    OR has_column_privilege(
        'unitrack_loans_service',
        'public.loans',
        'due_date',
        'UPDATE'
    ) THEN
        RAISE EXCEPTION
            'TEST 11 FAILED: Historical loan fields are writable';
    END IF;

    RAISE NOTICE
        'PASS: Loans Service UPDATE permissions are restricted';
END;
$$;


ROLLBACK;
