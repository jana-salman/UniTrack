-- C3/C4: protect in-progress handovers and make fulfilled reservations terminal.
-- Apply after S2-09, 007, S2-05, and S2-01_reservation_permissions.sql.
-- This adds no table privileges or RLS policies and leaves NH's handover
-- operation writer unchanged.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'reservations'
          AND column_name = 'handover_operation'
     )
     OR NOT has_column_privilege(
       'unitrack_loans_service', 'public.reservations', 'status', 'UPDATE'
     )
     OR NOT has_column_privilege(
       'unitrack_loans_service', 'public.reservations', 'handover_operation', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'Reservation status protection requires the S2-01 and S2-09 reservation schema and grants.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_reservation_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_operation_state TEXT;
  new_operation_state TEXT;
  completed_loan_id TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'fulfilled' THEN
    RAISE EXCEPTION 'A fulfilled reservation is terminal and its status cannot change.'
      USING ERRCODE = '23514', CONSTRAINT = 'reservations_fulfilled_status_terminal';
  END IF;

  old_operation_state := OLD.handover_operation ->> 'state';
  new_operation_state := NEW.handover_operation ->> 'state';

  -- The only status transition allowed to finish a handover is the S2-09
  -- transaction: an applied durable plan, completed operation, and matching
  -- loan already inserted in this same transaction. Recovery uses this same
  -- final transaction. Compensation changes operation state only; after its
  -- confirmed `compensated` state, a future cancellation/expiry may proceed.
  IF NEW.status = 'fulfilled' THEN
    completed_loan_id := NEW.handover_operation #>> '{result,loanId}';
    IF OLD.status <> 'confirmed'
       OR old_operation_state IS DISTINCT FROM 'applied'
       OR new_operation_state IS DISTINCT FROM 'completed'
       OR NEW.handover_operation #>> '{result,reservationId}' IS DISTINCT FROM OLD.id::TEXT
       OR NEW.handover_operation #>> '{result,itemId}' IS DISTINCT FROM OLD.item_id::TEXT
       OR NEW.handover_operation #>> '{result,borrowerId}' IS DISTINCT FROM OLD.borrower_id::TEXT
       OR completed_loan_id IS NULL
       OR NOT EXISTS (
         SELECT 1
           FROM public.loans l
          WHERE l.id::TEXT = completed_loan_id
            AND l.reservation_id = OLD.id
            AND l.item_id = OLD.item_id
            AND l.borrower_id = OLD.borrower_id
            AND l.lab_id = OLD.lab_id
            -- S2-09 round-trips timestamps through JavaScript Date (ms),
            -- while PostgreSQL timestamptz retains microseconds.
            AND date_trunc('milliseconds', l.due_date)
                = date_trunc('milliseconds', OLD.end_at)
            AND l.student_confirmed_at IS NOT NULL
            AND l.university_id_verified_at IS NOT NULL
            AND l.university_id_verified_by::TEXT = (NEW.handover_operation ->> 'idVerifiedBy')
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.condition_records cr
          WHERE cr.loan_id::TEXT = completed_loan_id
            AND cr.item_id = OLD.item_id
            AND cr.lab_id = OLD.lab_id
            AND cr.phase = 'pickup'
       ) THEN
      RAISE EXCEPTION 'A reservation can be fulfilled only by a completed handover with its matching loan and pickup record.'
        USING ERRCODE = '23514', CONSTRAINT = 'reservations_fulfillment_requires_completed_handover';
    END IF;
    RETURN NEW;
  END IF;

  -- Fail closed for every non-null operation except a confirmed compensation.
  -- This includes unknown/malformed future states so a status writer cannot
  -- silently invalidate a durable handover plan.
  IF OLD.handover_operation IS NOT NULL
     AND old_operation_state IS DISTINCT FROM 'compensated' THEN
    RAISE EXCEPTION 'Reservation status cannot change while its handover is unfinished.'
      USING ERRCODE = '23514', CONSTRAINT = 'reservations_handover_status_protected';
  END IF;

  -- Even after a handover operation is absent or compensated, a reservation
  -- with a loan record cannot be cancelled, expired, or otherwise unconfirmed.
  -- SECURITY DEFINER lets the trigger enforce this without broadening Loans
  -- read privileges on the loans table.
  IF OLD.status = 'confirmed'
     AND NEW.status IN ('cancelled', 'expired', 'pending')
     AND EXISTS (SELECT 1 FROM public.loans l WHERE l.reservation_id = OLD.id) THEN
    RAISE EXCEPTION 'A confirmed reservation with a loan cannot be invalidated.'
      USING ERRCODE = '23514', CONSTRAINT = 'reservations_confirmed_loan_status_protected';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_reservation_status_transition() FROM PUBLIC;

DROP TRIGGER IF EXISTS reservations_protect_status_transition ON public.reservations;
CREATE TRIGGER reservations_protect_status_transition
BEFORE UPDATE OF status ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION public.protect_reservation_status_transition();

COMMIT;
