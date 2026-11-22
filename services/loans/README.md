# Loans Service

The authenticated Loans backend owns `loans`, `reservations`,
`reservation_resources`, and `condition_records`. It never queries Users or
Equipment tables directly. Reservation eligibility and kit contents come from
the Equipment service over signed HTTP. The web gateway aggregates borrower
and equipment labels through their owning services.

Reservation creation, handover, and any future cancellation or expiry writer
share the transaction-scoped per-item advisory lock:
`pg_advisory_xact_lock(hashtextextended('loans:item:' || item_id::text, 0))`.
For an existing reservation update, read `item_id`, acquire that item lock,
then lock the reservation row with `SELECT ... FOR UPDATE` and verify the item
did not change. Hold the lock through commit or rollback. Kit reservations also
lock the kit and tracked components in the canonical sorted item-ID order used
by the reservation service. PostgreSQL exclusion constraints remain the final
overlap guard.

There is currently no production cancellation or expiry writer; both are
deferred. The database blocks reservation status changes during unfinished
handovers and makes fulfilled reservations terminal. Do not add a status writer
without using the shared lock protocol above.

Routes provide confirmed student reservations, same-lab due dates, the
recoverable Return workflow, and S2-09 handover at
`/handover/:reservationId` (see
[handover architecture](../../docs/handover-s2-09.md)). Return and handover
call Equipment over signed HTTP with stable idempotency keys. Handover performs
completion, recovery, and compensation without changing the reservation write
ownership or lock contract.

Business routes require verified internal user tokens and enforce role/lab
scope. Configuration uses `INTERNAL_JWT_SECRET`, `DATABASE_URL`,
`EQUIPMENT_SERVICE_URL`, and `LOANS_DATABASE_SESSION_AFFINITY=confirmed`. The
database connection must be direct or session pooled because Return holds a
session advisory lock across commits; transaction pooling is incompatible.

Migrations are applied by the database owner, never automatically by the
service. From the repository root, build shared packages before independent
use. Run `npm run dev --workspace=@unitrack/loans` on port 3003, or
`npm run dev:all` for all four applications. Root test, lint, typecheck, and
build commands include this workspace. Tests use synthetic credentials and
isolated database fixtures only.

See [Loans return architecture](../../docs/architecture/loans-returns-extraction.md),
[S2-09 handover](../../docs/handover-s2-09.md), and the current
[handoff](../../docs/architecture/handoff.md).
