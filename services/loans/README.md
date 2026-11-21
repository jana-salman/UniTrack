# Loans Service

Independent authenticated Next.js Loans backend. It owns `loans`,
`reservations`, `reservation_resources`, and `condition_records`; it never
queries Users or Equipment tables. Routes provide confirmed student
reservations, same-lab due dates and the recoverable return workflow.
Reservation eligibility and kit contents are checked through signed Equipment
HTTP. Reservation writes use the shared `loans:item:<uuid>` transaction lock,
and PostgreSQL exclusion constraints remain the final overlap guard. Returns
call Equipment over signed HTTP with stable idempotency keys. Web aggregates
borrower/equipment labels through the owning services.

Future reservation cancellation or expiry writers must use the same
transaction-scoped item lock as creation and handover:
`pg_advisory_xact_lock(hashtextextended('loans:item:' || item_id::text, 0))`.
Read the reservation's `item_id` to name the lock, acquire the item lock first,
then lock the reservation row with `SELECT ... FOR UPDATE` and verify the item
did not change before updating status. Hold the lock through commit/rollback.
There is currently no production cancellation or expiry writer. The database
blocks status changes during unfinished handovers and makes fulfilled
reservations terminal.

Public `GET /health` is configuration-free. Business routes require verified
internal user tokens and enforce role/lab scope. Configuration names are
`INTERNAL_JWT_SECRET`, `DATABASE_URL`, `EQUIPMENT_SERVICE_URL`, and
`LOANS_DATABASE_SESSION_AFFINITY=confirmed`. The database URL must use a direct
or session-pooled connection because the return Saga holds a session advisory
lock across commits; transaction pooling is incompatible.

The database owner reports migrations 003-005 applied and verified. Proposed
service-isolation migration 006 remains unapplied and is never run by the
application. The return operation is request-recoverable; background operator
recovery remains product/operations work rather than a hidden startup task.

From the repository root, build shared packages before independent use. Run
`npm run dev --workspace=@unitrack/loans` on port 3003, or `npm run dev:all` for
all four applications. Root typegen, test, lint, typecheck, and build commands
include this workspace. Tests use synthetic credentials and isolated database
fixtures only.

See [Loans return architecture](../../docs/architecture/loans-returns-extraction.md)
and the current [handoff](../../docs/architecture/handoff.md).
