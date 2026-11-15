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
proves they are removed. PostgreSQL 16 supplies `gen_random_uuid()`. The current
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

If a run is interrupted, remove only this explicitly named local Compose
project:

```powershell
docker compose --project-name unitrack-migration-test --file .\database\local-test\compose.yaml down --volumes --remove-orphans
```

Do not substitute a Supabase URL or copy real data into this harness.
