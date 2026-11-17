# Handover — S2-09 / C430PRJCT-40 (NH)

Kit checklist, condition and student confirmation. A lab assistant opens
`/handover/[reservationId]`, ticks every row, records a condition (with optional
notes), and the student ticks the confirmation box on the same screen. The
handover is complete only after that confirmation and a successful Equipment
checkout.

## Unresolved assumptions (not accepted requirements)

- **A1 — missing required component.** Checkout is currently allowed when a
  *required* component is marked Missing. This is NOT a confirmed policy. It was
  chosen only because TC-3.4 needs the missing-charger record saved and
  `condition_records.loan_id` is mandatory. Awaiting the Product Owner; if the
  answer is "block", add an `isRequired` check in
  `services/loans/lib/handover/rules.ts` (no schema change needed).
- **A2 — `available` accepted at handover.** Checked against the existing code:
  nothing creates reservations or moves an item to `reserved` when a reservation
  starts; the only writer of `reserved` is Return (active pickup window), and
  `database/data-model.md` says reservations do not change physical status. An
  item with a valid confirmed in-window reservation can therefore still be
  `available`, so handover accepts `reserved` or `available` and never changes a
  reservation rule. This does **not** conflict with TC-3.7: an unconfirmed
  attempt makes no Equipment call at all, so a Reserved item stays Reserved (and
  an Available one stays Available). Awaiting the reservations owner; if items
  must always be `reserved` first, remove `available` in
  `services/loans/lib/handover/service.ts`.

## Behaviour

| Rule | Where it is enforced |
| --- | --- |
| Lab assistants only (`lab_assistant`; managers, professors and students are denied) | Page guard, Web gateway (before any service call), Loans route + service |
| Student must confirm (`studentConfirmed: true`) | Loans rejects with 400 `student_confirmation_required` before any database or Equipment access; RLS on new loans also requires `student_confirmed_at` |
| SC eligibility: reservation and equipment in the assistant's lab; `confirmed`; `start_at <= server now < end_at`; no active loan for the item; it is the ONLY confirmed reservation for the item whose window contains now | Loans, on locked rows: when the plan is made, before a new attempt after an undo, and again in the final loan transaction at the server's current time. A per-item transaction lock (`loans:handover:item:<id>`) serializes handovers of different reservations for one item. Failing at final submission undoes the checkout (ownership-guarded) and returns the failed rule as 409. |
| Equipment status must be `reserved` or `available` (**unresolved assumption A2**) | Loans (read from Equipment over HTTP) |
| Checklist = every **active** kit component exactly once (actual IDs), or one main-item row (`kitComponentId: null`) for non-kit equipment; every row ticked; valid condition; notes ≤ 1000 chars | Loans, against Equipment's component list |

Condition labels → stored values: Good → `good`, Existing damage → `damaged`,
Missing component → `missing`, Needs attention → `unknown`. "Ticked" means
*checked by the assistant*, not *present*: a missing charger is ticked and marked
Missing with its note. No photo is required for existing damage.

On success Loans creates exactly one loan (`due_date` = reservation `end_at`,
`student_confirmed_at` = accepted time) and one `phase = 'pickup'` condition
record per row, and Equipment moves the item `reserved/available → checked_out`
(Borrowed) through its existing keyed status API. Return is unchanged; its form
already shows the main item plus every pickup component, and the real-PostgreSQL
test returns loans created by this handover.

## APIs (shared contracts in `packages/contracts/src/handover.ts`)

- Web `GET /api/handover/:reservationId` → reservation, Equipment name/asset
  code/status, active components, borrower name, due date, completed handover
  (if any) and `pendingOperation`. If Equipment components cannot be read the
  checklist is not shown (no guessing kit vs. non-kit).
- Web `POST /api/handover/:reservationId` → body
  `{ studentConfirmed, conditions: [{ kitComponentId, checked, conditionStatus, notes }] }`;
  returns `{ loanId, reservationId, itemId, borrowerId, borrowedAt, dueDate, studentConfirmedAt, status: "checked_out" }`.
- Loans `GET|POST /handover/:reservationId` (signed `lab_assistant` user only).

## Reliability (same protocol as the reviewed return Saga)

1. Session advisory lock per reservation (concurrent submits get 409; Loans keeps
   its existing direct/session-pooled connection requirement).
2. Validate, then **commit a durable plan** in `reservations.handover_operation`
   (stable Equipment key, attempt, actor, accepted time, pre-generated loan ID)
   *before* contacting Equipment. There is no loan yet, so the plan cannot live
   on the loan as `return_operation` does.
3. Equipment checkout with `Idempotency-Key handover:<uuid>:<attempt>:apply` and
   `expectedStatus` = the observed prior status. A lost response is retried with
   the same key; a replayed receipt is re-checked against current status.
4. One local transaction inserts the loan and all pickup records and marks the
   plan completed. Double clicks / retries with identical input replay the
   stored result; different input or a different assistant gets 409.
5. Only an acknowledged rollback allows undo, guarded by Equipment operation
   ownership (`expectedOperationKey`). Uncertain COMMIT/ROLLBACK, lost undo
   responses or ownership conflicts are reported as
   `handover_state_uncertain` and never compensated blindly. The UI then locks
   the form and offers **Retry the same handover** only.

Recovery is request-driven (no background worker), like Return. If the page is
reloaded during an unfinished attempt, it shows a notice: the same assistant must
re-enter the identical checklist and notes, or staff must reconcile. Loans never
updates or deletes loans or condition records during handover.

### Compensation cannot overwrite a later status change

Undo (`checked_out → previous status`) is only attempted after an acknowledged
local rollback with no loan for the reservation, and Equipment applies it under
its item row lock only if BOTH the status is still `checked_out` AND the item's
`status_request_key` is still this handover's apply key. Migration 005 triggers
clear that key on every later status write (keyed, unkeyed, or the same value),
so any legitimate later change (repair, a different handover, even
`checked_out → under_maintenance → checked_out`) makes the undo fail as
`handover_state_uncertain`; nothing is overwritten and the plan stays
`compensating` for staff. Concurrent attempts on the same reservation are
serialized by the advisory lock; overlapping reservations for one item race on
Equipment's `expectedStatus` check and `loans_one_active_per_item`, so exactly
one wins and the loser never applied anything to undo. Real-PostgreSQL tests
cover both later-change cases and the overlapping-reservation race. Relies on
migration 005 being applied (owner-reported on shared Supabase).

Dev-mode note: Loans waits 3 s for Equipment (same adapter as Return). The first
request to an Equipment route under `next dev` can take longer while it
compiles; Loans then reports `handover_state_uncertain` (nothing is saved, or the
retry replays the same key). Use **Retry the same handover**.

## Migration — `database/migrations/C430PRJCT-40_S2-09_handover_confirmation.sql`

Apply **after 004 and 006**, by the database owner, in a controlled step. Not run
by the app. Additive and idempotent:

- `loans.student_confirmed_at TIMESTAMPTZ` (nullable; existing loans stay NULL).
- `reservations.handover_operation JSONB` (nullable).
- Column-level grants to `unitrack_loans_service`: `INSERT (id, item_id,
  borrower_id, reservation_id, lab_id, borrowed_at, due_date,
  student_confirmed_at) ON loans` and `UPDATE (handover_operation) ON
  reservations`. Migration 006 gave Loans no INSERT on `loans`, so handover could
  not work under 006 without this. Loans still cannot insert `returned_at` or
  `return_operation`, update reservation status, or update/delete condition
  records.
- Two RLS policies (`c430prjct_40_loans_handover_insert` requiring
  `student_confirmed_at IS NOT NULL AND returned_at IS NULL`, and
  `c430prjct_40_reservations_handover_update`). Names avoid 006's
  `unitrack_*_service_*` pattern and grants are column-level, so
  `postflight_006_read_only.sql` still passes.
- If the roles do not exist yet (006 not applied), only the columns are added
  and a NOTICE is printed. 006's `REVOKE ALL` also removes column grants, so
  **re-run this file after applying 006**.

Shared Supabase was not touched. Verified on disposable PostgreSQL via
`database/local-test/run.ps1` (applies it twice, runs
`verify_C430PRJCT-40.sql` and `services/loans/tests/postgres-handover.integration.test.ts`
as the restricted service roles).

## Shared changes to coordinate

- `packages/contracts`: new `handover.ts`; `LOANS_ERROR_CONTRACT` gains handover
  messages/codes (existing entries unchanged).
- `services/loans/lib/equipment-http.ts`: private request helper hoisted to module
  level so a handover adapter can reuse it; return adapter behaviour, messages
  and `getComponents` are unchanged.
- `services/loans/lib/errors.ts`: adds `handoverUncertain()`.
- `database/local-test/run.ps1`: two additive steps for this migration and test.
- No navigation, login, seed, Return, reservation, scan or lookup changes.

## Manual browser testing (disposable database, restricted accounts)

`database/local-test/handover-manual.ps1 -Action Setup -AssistantId <your
Supabase user ID> -AssistantEmail <your email>` starts a local container, applies
003-006 and this migration, creates `unitrack_{users,equipment,loans}_local`
LOGIN accounts that only inherit their 006 group roles
(`manual_service_logins.sql`), and loads `handover_manual_fixture.sql`. Then run
`-Action Run -Service users|equipment|loans` in three terminals: each service
connects with its OWN restricted account (never the container superuser), and the
script restores the terminal's `DATABASE_URL`/`LOANS_DATABASE_SESSION_AFFINITY`
when it exits. Start Web normally. `-Action Teardown` removes everything.
`.env.local` files are never read or edited.

## Open questions

- **PO (A1):** may a kit be handed over when a *required* component is missing?
- **PO:** should a kit's case/body also get its own pickup row (main item) in
  addition to the components? Currently kits record components only, as specified;
  Return still asks for the main item at return with no pickup baseline.
- **PO:** pickup is allowed only during `start_at <= now < end_at` (Return's
  existing active-pickup rule). Is early pickup needed?
- **Reservations owner:** should handover mark the reservation `fulfilled`?
  Handover does not change reservation status (Loans has no grant for it); the
  unique `loans.reservation_id` already blocks a second handover. Does your card
  move Equipment to `reserved` when the pickup window starts? Handover accepts
  `reserved` or `available`.
- **SC / reservations owner (concurrency):** the per-item lock only serializes
  handovers. A reservation confirmed or created by another writer between the
  final eligibility count and the loan COMMIT is not blocked. Either take the same
  `pg_advisory_xact_lock(hashtextextended('loans:handover:item:' || item_id, 0))`
  when confirming/creating reservations, or add a database rule preventing
  overlapping confirmed reservations. (Cancelling THIS reservation is blocked by
  the handover's row lock until COMMIT.)
- **SN (custody):** future loan-update protection must still allow Loans to INSERT
  handover loans and UPDATE `reservations.handover_operation`.
