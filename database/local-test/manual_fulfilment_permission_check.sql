-- DISPOSABLE LOCAL DATABASE ONLY (never Supabase). Run by handover-manual.ps1
-- -Action Setup AFTER SYNTHETIC_s2-01_reservation_status_grant.sql,
-- manual_service_logins.sql and handover_manual_fixture.sql.
--
-- Proves that the browser services' restricted LOGIN accounts can perform the
-- handover's fulfilment and nothing broader:
--   * unitrack_loans_local inherits UPDATE (status) on reservations from the
--     SYNTHETIC stand-in grant to unitrack_loans_service (it is a LOGIN INHERIT
--     member of that group, see manual_service_logins.sql);
--   * no table-level UPDATE and no other reservation column is updatable;
--   * the Users and Equipment logins cannot update reservation status;
--   * the exact handover statement works as that login (rolled back).
-- The grant is a local stand-in for LJ's S2-01 migration, NOT that migration.
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF NOT has_column_privilege('unitrack_loans_local', 'public.reservations', 'status', 'UPDATE')
     OR NOT has_column_privilege('unitrack_loans_local', 'public.reservations', 'handover_operation', 'UPDATE') THEN
    RAISE EXCEPTION 'Manual setup: the Loans login cannot mark reservations fulfilled (synthetic grant missing?)';
  END IF;
  IF has_table_privilege('unitrack_loans_local', 'public.reservations', 'UPDATE')
     OR has_table_privilege('unitrack_loans_local', 'public.reservations', 'INSERT')
     OR has_table_privilege('unitrack_loans_local', 'public.reservations', 'DELETE')
     OR has_column_privilege('unitrack_loans_local', 'public.reservations', 'start_at', 'UPDATE')
     OR has_column_privilege('unitrack_loans_local', 'public.reservations', 'end_at', 'UPDATE')
     OR has_column_privilege('unitrack_loans_local', 'public.reservations', 'item_id', 'UPDATE')
     OR has_column_privilege('unitrack_loans_local', 'public.reservations', 'borrower_id', 'UPDATE')
     OR has_column_privilege('unitrack_loans_local', 'public.reservations', 'lab_id', 'UPDATE')
     OR has_column_privilege('unitrack_equipment_local', 'public.reservations', 'status', 'UPDATE')
     OR has_column_privilege('unitrack_users_local', 'public.reservations', 'status', 'UPDATE') THEN
    RAISE EXCEPTION 'Manual setup: reservation permissions are broader than the synthetic stand-in';
  END IF;
END;
$$;

-- The handover's fulfilment statement, as the restricted Loans login (rolled back).
BEGIN;
SET LOCAL ROLE unitrack_loans_local;
DO $$
DECLARE
  changed integer;
BEGIN
  UPDATE public.reservations SET status = 'fulfilled', handover_operation = handover_operation
  WHERE id = (SELECT id FROM public.reservations WHERE status = 'confirmed' ORDER BY id LIMIT 1);
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'Manual setup: the Loans login could not run the fulfilment update (RLS?)';
  END IF;
END;
$$;
ROLLBACK;

SELECT 'PASS: Loans login can mark reservations fulfilled via the SYNTHETIC local stand-in grant (not LJ''s migration)' AS result;
