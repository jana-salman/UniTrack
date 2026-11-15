# Migrations 003-005 verification and staging runbook

This runbook finishes the database-readiness work already recorded in
`docs/architecture/handoff.md`. It does not replace the established baseline
verification and does not authorize access to or changes in Supabase.

## Scope and existing evidence

The database owner has already verified the real database has all ten required
tables, nullable-text `equipment_status_history.request_key`, the correct valid
and ready unique partial request-key index, and all four enabled baseline
protection triggers. The target columns for 003, 004 and 005 are absent.

`database/verification/preflight_003_005.sql` covers the remaining automated
checks. It is read-only and must be run by an authorized operator. It is one
`WITH ... SELECT`, so Supabase SQL Editor returns one result
grid. Export that grid as CSV with the project/environment name and timestamp,
but never include connection strings or credentials.

In Supabase Dashboard, open the confirmed project, open SQL Editor, create a
new query, paste the complete script, leave the whole query selected (or select
nothing), and choose **Run** once. Export the single result grid as CSV. Locate
`00_OVERALL_MIGRATION_GATE` and `00_OVERALL_RUNTIME_GATE`: both must be `PASS`.
Any other automated `FAIL` is a stop condition. Preserve every `INFO` inventory
row in the same CSV for the manual grant, policy and legacy-key review.

## PASS/FAIL report

Record one row per automated check using the script output:

| Gate | Check | Result | Evidence / mismatch | Owner |
| --- | --- | --- | --- | --- |
| MIGRATION | `00_OVERALL_MIGRATION_GATE` | PASS or FAIL | Copy summary | Database owner |
| RUNTIME | `00_OVERALL_RUNTIME_GATE` | PASS or FAIL | Copy summary | Database owner |

The exported grid also includes `GRANT_INVENTORY`, `POLICY_INVENTORY` and
`LEGACY_KEY_INVENTORY` rows with `INFO` status. Then record the manual checks
that cannot be inferred safely:

| Manual check | PASS condition | Result |
| --- | --- | --- |
| Correct Supabase project | Project reference/environment independently confirmed | PASS or FAIL |
| Backup/restore | Current backup or PITR and restore procedure confirmed | PASS or FAIL |
| Grant mapping | Every `GRANT_INVENTORY` row is mapped to an approved owner/runtime role; no unexplained writer | PASS or FAIL |
| RLS policy review | `POLICY_INVENTORY` matches the approved design; owner/bypass behavior is understood | PASS or FAIL |
| Connection mode | Loans is configured for a direct or session-pooled connection, not transaction pooling | PASS or FAIL |
| Writer coordination | Legacy return code and competing migration writers are stopped for the staging exercise | PASS or FAIL |

The preflight is approved only when both automated overall rows and every
manual row are PASS. Any failure is a stop condition: investigate it rather
than editing history, dropping objects or relying on `IF NOT EXISTS`.

## Staging execution order

Use an isolated staging database cloned from representative data. Do not use
the real production/shared database for the first execution or behavior tests.

For this project, which has no separate hosted staging database, first run the
disposable Docker harness in `database/local-test/`. It reuses this preflight,
the baseline schema/triggers, and the existing migration files with synthetic
data. A local PASS provides PostgreSQL migration/trigger/application evidence;
it does not replace the real database preflight, backup, grants/RLS review, or
Supabase Auth and connection-mode checks. See
`database/local-test/README.md` for the exact command and limitations.

1. **Capture the baseline.** Run the read-only preflight, save all outputs, and
   record row counts for `equipment_items`, `equipment_status_history`, `loans`
   and `condition_records`. Record the count of existing keyed history rows.
2. **Apply 003 only.** Execute
   `database/migrations/003_equipment_request_fingerprint.sql` as the approved
   migration owner. Stop on any error; do not continue to 004.
3. **Verify 003.** Confirm `request_fingerprint` is nullable `text`, all
   pre-existing keyed rows have a null fingerprint, history row counts are
   unchanged, and the request-key index and immutable trigger remain valid and
   enabled. Through the staged Equipment API, verify a new keyed operation
   writes one 64-character hexadecimal fingerprint, an exact retry adds no
   second history row, and different input under the same key returns 409.
4. **Apply 004 only.** Execute
   `database/migrations/004_loans_return_operation.sql`. Stop on any error.
5. **Verify 004.** Confirm `return_operation` is nullable `jsonb`, all existing
   loan values are null, loan/history/condition counts are unchanged, and the
   active-loan index plus deletion-protection triggers remain valid/enabled.
   Do not enable return traffic yet: the compensation guard is still absent.
6. **Apply 005 only.** Execute
   `database/migrations/005_equipment_operation_guard.sql`. Stop on any error.
7. **Verify 005 structure.** Confirm `status_request_key` is nullable `text`
   and null on pre-existing items. Confirm both new functions have the reviewed
   definitions and both triggers are enabled on the correct tables. Confirm all
   baseline triggers remain enabled and row counts are unchanged.
8. **Verify 005 behavior in staging.** Use disposable staged records to prove:
   a keyed status change records its key as owner; an unkeyed status write
   clears ownership; a keyed no-op records ownership; a later different action
   invalidates the old owner even if status returns to the same value; and an
   undo carrying the stale `expectedOperationKey` is rejected without changing
   status or immutable history.
9. **Verify the complete return Saga.** Run a clean return, exact replay,
   conflicting replay, Equipment timeout/retry, confirmed local rollback and
   compensation, stale compensation rejection, and simultaneous return
   attempts using real staging PostgreSQL and the real HTTP services. Verify
   operation states and immutable receipts after each case.
10. **Verify pool behavior.** With the intended staging connection type, prove
    the session advisory lock stays on the same backend across commits and is
    released after normal completion and connection destruction. Do not use a
    transaction-mode pooler.
11. **Produce the staging report.** Attach pre/post definitions, row counts,
    application results and sanitized logs. Production/shared-database approval
    is a separate decision; this runbook does not grant it.

## Stop conditions

Stop and request an owner decision if an expected object has the wrong type or
definition, any target column/function/trigger already exists, an index or
constraint is invalid, unexplained write grants exist, row counts change during
additive DDL, legacy operations are in flight, or any commit outcome is
uncertain. Never repair these conditions by deleting immutable history.
