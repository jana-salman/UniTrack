-- DISPOSABLE LOCAL DATABASE ONLY (never Supabase). Run by handover-manual.ps1
-- -Action Setup after the actual S2-01 and S2-09 migrations, and after
-- manual_service_logins.sql and handover_manual_fixture.sql.
--
-- Proves that the browser services' restricted LOGIN accounts have only the
-- approved reservation grants needed by the handover:
--   * unitrack_loans_local inherits the narrow UPDATE (status) grant from
--     LJ's S2-01 migration (it is a LOGIN INHERIT member of the group);
--   * no table-level UPDATE and no other reservation column is updatable;
--   * the Users and Equipment logins cannot update reservation status;
-- C3/C4 require a real completed handover for a fulfilled transition, so this
-- verifier checks privileges only and does not synthesize a status update.
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF NOT has_column_privilege('unitrack_loans_local', 'public.reservations', 'status', 'UPDATE')
     OR NOT has_column_privilege('unitrack_loans_local', 'public.reservations', 'handover_operation', 'UPDATE') THEN
    RAISE EXCEPTION 'Manual setup: the Loans login lacks the S2-01/S2-09 column grants';
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
    RAISE EXCEPTION 'Manual setup: reservation permissions are broader than the approved column grants';
  END IF;
END;
$$;

SELECT 'PASS: Loans login inherits the narrow reservation grants from the actual S2-01 and S2-09 migrations' AS result;
