# Disposable PostgreSQL migration test

This harness verifies migrations 003-007 and S2-02 without contacting Supabase. It uses
PostgreSQL 16 in Docker, binds only to `127.0.0.1:55432`, stores the database in
container `tmpfs`, and removes the container when the run finishes. The fixed
database password and records are synthetic local-test values, not secrets.

## What it reuses

The container initializes from the repository's existing `database/schema.sql`,
`database/triggers.sql`, and request-key migration. The runner then executes the
existing read-only preflight and applies 003, 004, 005, 006, S2-02, and 007 in
order, verifying each migration. It stops after any failed preflight, migration,
SQL assertion, or focused application test.

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
PASS: migrations 003-007 and S2-02, plus the focused microservice integration checks, passed locally.
```

The focused tests cover migrated column definitions, both unique partial
indexes, immutable history, migration 005 ownership triggers, exact replay,
conflicting replay, keyed no-ops, legacy ownership clearing, stale ABA undo
rejection, and a clean/replayed Loans return using the production Loans service
as the restricted `unitrack_loans_service` role and the Equipment transaction
function against real PostgreSQL. Migration 006 also
checks password-free group roles, least-privilege grants, RLS policies, owned
table operations, sequence access, and denied cross-service table reads.
Migration 007 checks immutable loan and condition history, pickup and return
condition INSERT permissions, recovery/compensation state transitions, a
commit-time completed-return invariant, and compatibility with legacy returned
loans.

## Pending S2-09 / reservation integration

When S2-09 lands, apply and verify its handover migration after S2-02 and before
007. Migration 007 deliberately runs last for `public.loans` so its final ACL is
column-level UPDATE on only `returned_at` and `return_operation`; it does not
revoke S2-09's loan INSERT columns or any `public.reservations` permissions.
Keep S2-09's confirmation/identity-evidence trigger alongside 007's loan trigger.
The combined runner must also retain the restricted-role handover PostgreSQL
suite and adapt its overlapping-confirmed fixture to S2-02's exclusion
constraint. LJ's reservation guard/status-grant migration follows S2-09 because
it depends on `reservations.handover_operation`.

If a run is interrupted, remove only this explicitly named local Compose
project:

```powershell
docker compose --project-name unitrack-migration-test --file .\database\local-test\compose.yaml down --volumes --remove-orphans
```

Do not substitute a Supabase URL or copy real data into this harness.
