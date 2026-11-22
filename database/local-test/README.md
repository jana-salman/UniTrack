# Disposable PostgreSQL verification

`run.ps1` exercises the combined S2-01, S2-02, S2-05, S2-09, S2-10/11 Return,
and S2-13 custody database/application paths. It uses PostgreSQL 16 in Docker,
the isolated `unitrack-sprint2-verification` Compose project, and loopback port
55433. Its database is disposable and removed at the end of a successful or
failed run unless `-KeepDatabase` is supplied. It never contacts Supabase.

The separate `unitrack-migration-test` project on port 55432 contains SC's
preserved browser acceptance fixtures. This runner sets a temporary port
override for its own Compose process and must not be pointed at that database.

## Migration sequence

The runner applies and verifies migrations in dependency order:

`003 → 004 → 005 → 006 → S2-02 → S2-09 → 007 → S2-05 → S2-01 permissions → C3/C4 status guard`

The S2-09 migration is the checked-in `C430PRJCT-40_S2-09_handover_confirmation.sql`;
it is applied twice to verify idempotency. Its verification runs before and
after migration 007. S2-02's confirmed-only exclusion constraint is verified
again after S2-09. Migration 007 keeps final `public.loans` update privileges
limited to `returned_at` and `return_operation`, without removing S2-09 loan
insert privileges or reservation permissions.

The harness applies the actual S2-01 permission migration, then its status
guard migration. The synthetic S2-01 grant file from the original S2-09 branch
is not used by the runner, integration tests, or manual fixture setup. The
restricted-role handover tests verify the real grant and revoke/reapply only
that column privilege for negative-path tests.

## Run

From the repository root with Docker Desktop running:

```powershell
& .\database\local-test\run.ps1
```

No host `psql` is needed. The runner sets `UNITRACK_TEST_DATABASE_URL` only for
focused Vitest children; those tests reject any URL other than the fixed local
loopback URL. `-KeepDatabase` preserves only the disposable 55433 project after
a successful run for local inspection. To remove it manually:

```powershell
docker compose --project-name unitrack-sprint2-verification --file .\database\local-test\compose.yaml down --volumes --remove-orphans
```

## Coverage

The baseline uses synthetic auth roles and data to exercise Supabase-specific
SQL paths; it is not a Supabase Auth emulator. The migrations and verifiers
cover least-privilege service roles, RLS, S2-01 inserts/status updates, S2-02
overlap exclusion, S2-05 kit/resource integrity, S2-09 handover permissions,
and S2-13 custody constraints.

Focused PostgreSQL suites cover kit creation/edit/component membership and
validation; reservation overlaps, adjacency, status filtering, concurrency,
kit/component conflicts and unchanged current equipment status; restricted
Loans C3/C4 status protection; S2-09 completion, recovery, compensation and
handover concurrency; and Return migration/replay/rollback/ownership behavior.
Fixtures and credentials are synthetic local-test values, not secrets. Never
substitute a shared database URL or copy real data into this harness.

The manual browser handover fixture is separate and uses
`handover-manual.ps1`; it applies the real S2-01 migration and is not invoked by
the combined verification runner. See [handover docs](../../docs/handover-s2-09.md).
