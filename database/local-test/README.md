# Disposable PostgreSQL migration test

This harness verifies migrations 003-005 and the proposed service-isolation
migration 006 without contacting Supabase. It uses
PostgreSQL 16 in Docker, binds only to `127.0.0.1:55432`, stores the database in
container `tmpfs`, and removes the container when the run finishes. The fixed
database password and records are synthetic local-test values, not secrets.

## What it reuses

The container initializes from the repository's existing `database/schema.sql`,
`database/triggers.sql`, and request-key migration. The runner then executes the
existing read-only preflight and applies the existing 003, 004, and 005 files in
order, then applies and verifies 006. It stops after any failed preflight,
migration, SQL assertion, or focused application test.

`00_supabase_compat.sql` supplies the `auth.users(id)` object and synthetic
`anon`/`authenticated` roles needed to exercise the Supabase-specific revoke
path. The baseline gives those roles disposable privileges and 006 verification
proves they are removed. It also gives one safe pre-existing service group
deliberately excessive disposable privileges so 006 must normalize them; the
other two service groups exercise the creation path. PostgreSQL 16 supplies
`gen_random_uuid()`. The current
schema and migrations use no other Supabase-only database object. This is not a
Supabase Auth emulator and does not verify JWT claims, Supabase API behavior,
hosted backups, login-role membership, or pooler configuration.

## Run

Start Docker Desktop, then run from the repository root:

```powershell
& .\database\local-test\run.ps1
```

No host `psql` installation is required. The runner uses the client inside the
container and sets `UNITRACK_TEST_DATABASE_URL` only for the focused Vitest
child process. The integration test refuses every URL except the fixed local
loopback database created by this harness.

Expected final output:

```text
PASS: migrations 003-006 and the focused microservice integration checks passed locally.
```

The focused tests cover migrated column definitions, both unique partial
indexes, immutable history, migration 005 ownership triggers, exact replay,
conflicting replay, keyed no-ops, legacy ownership clearing, stale ABA undo
rejection, and a clean/replayed Loans return using the production Loans service
and Equipment transaction function against real PostgreSQL. Migration 006 also
checks password-free group roles, least-privilege grants, RLS policies, owned
table operations, sequence access, and denied cross-service table reads.

After 006 the runner applies the C430PRJCT-40 (S2-09 handover) migration twice
to prove it is idempotent, runs `verify_C430PRJCT-40.sql`, and runs
`services/loans/tests/postgres-handover.integration.test.ts` with Loans and
Equipment connected as their restricted 006 group roles. That test creates its
own synthetic lab, kits, components and reservations.

**Synthetic permission (not LJ's migration).** Handover marks the reservation
`fulfilled`, which needs `UPDATE (status)` on `public.reservations` for the
Loans group. That grant belongs to LJ's S2-01 reservation-write migration,
which does not exist yet. The handover integration test (and
`handover-manual.ps1 -Action Setup`) therefore applies
`SYNTHETIC_s2-01_reservation_status_grant.sql` — that one column grant, nothing
else — after `verify_C430PRJCT-40.sql` has confirmed that the S2-09 migration
alone grants no status update. For the browser setup,
`manual_fulfilment_permission_check.sql` then proves the restricted
`unitrack_loans_local` login inherits exactly that permission and nothing
broader. Passing tests with this stand-in does **not**
verify LJ's final migration. The test's `cancelUnderContract` helper and its
COMMIT-fault trigger are also test-only.

`handover-manual.ps1` (with `manual_service_logins.sql` and
`handover_manual_fixture.sql`) prepares a separate disposable database for
clicking through `/handover/[reservationId]`, with each service connecting as its
own restricted 006 login; see
[docs/handover-s2-09.md](../../docs/handover-s2-09.md). It is never run by the
runner and must never be run against Supabase.

If a run is interrupted, remove only this explicitly named local Compose
project:

```powershell
docker compose --project-name unitrack-migration-test --file .\database\local-test\compose.yaml down --volumes --remove-orphans
```

Do not substitute a Supabase URL or copy real data into this harness.
