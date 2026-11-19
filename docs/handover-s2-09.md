# Handover — S2-09 / C430PRJCT-40 (NH)

Kit checklist, condition and student confirmation. A lab assistant opens
`/handover/[reservationId]`, ticks every row, records a condition (with optional
notes), checks the student's university ID card in person and ticks the ID check,
and the student ticks the confirmation box on the same screen. The handover is
complete only after both ticks, a Users check that the borrower is an active
student of the lab, and a successful Equipment checkout; it then saves the loan,
every pickup record and the reservation's change to `fulfilled` in one database
transaction (final PO decisions of 2026-11-19, see "Reservation fulfilment").

## Final Product Owner requirements (confirmed by JS) — RESOLVED

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Borrower must be an **active, same-lab Student** matching the confirmed reservation | Users `GET /profiles/:id/borrower` reports `id, full_name, role, lab_id, is_active` (staff-only, same lab, other labs 404). Loans applies one shared rule, `isEligibleBorrower` (contracts): id = the reservation's `borrower_id`, `lab_id` = the reservation's lab, `role = 'student'`, `is_active`. Checked before checkout and again after checkout before saving; the final transaction also re-reads the reservation (same borrower, item, lab and dates). Fails closed: not found / not a student / other lab / inactive / other id → 409 `borrower_unverified`; Users unreachable or malformed → 503 `borrower_unavailable` before checkout or `handover_incomplete` after it. The page shows the checklist only when the same rule passes. | Loans adapter tests (student, lab assistant, professor, lab manager, other lab, inactive, wrong id, missing lab, 404, 5xx, network); service tests (authoritative id+lab, ineligible before and after checkout); gateway tests (non-student, other lab); real PostgreSQL via the restricted Users role (lab assistant, other-lab student, inactive student). |
| Assistant physically verifies the student's **university ID**; no student login or ID upload | Separate **University ID check (lab assistant)** checkbox, independent of the student's confirmation. Loans requires `universityIdVerified: true` (400 `id_verification_required` before any database, Users or Equipment access) **and** `studentConfirmed: true`. Evidence stored with minimal schema: `loans.university_id_verified_at` + `loans.university_id_verified_by` (the assistant). No ID number, upload, photo or student sign-in; unknown body fields are ignored and never stored. | Service, route, gateway and UI tests (ID tick missing, ID tick without confirmation, confirmation without ID tick, extra ID-number/photo fields not stored, no text/file inputs); migration static + `verify_C430PRJCT-40.sql` + PostgreSQL RLS tests. |
| Durable, retryable recovery is sufficient; no worker; no cross-assistant expansion | Unchanged request-driven Saga and existing recovery (kept, not removed). The durable plan now also stores the ID-check evidence (`idVerifiedBy` + `universityIdVerifiedAt`) and the confirmed dates, so recovery reuses the ORIGINAL verification and checklist and never asks again. No background worker added; who may recover is unchanged. | Recovery by the starter and (for `applied`) another assistant keeps `university_id_verified_by` = original assistant (service + PostgreSQL); corrupted/missing evidence in a stored plan → `handover_state_uncertain`. |
| UI clearly shows uncertain outcomes and prevents fresh submissions while unresolved | Outcomes are classified: **completed** (200), **failed** (4xx, `borrower_unavailable`, `handover_rolled_back`: nothing handed over, form stays editable) and **uncertain** (other 5xx such as `handover_state_uncertain`/`handover_incomplete`, network errors, unverifiable responses). After any unsuccessful attempt the page re-reads Loans: an unresolved operation replaces the form with **Handover not finished — outcome uncertain**, keeps the error visible, states that a new handover cannot start, and offers only **Finish interrupted handover** (the same operation). If no operation was saved (e.g. lost connection), the form is locked under **Outcome not confirmed** and only **Retry the same handover** (identical information, same key) is possible. Loans independently refuses a different submission while an operation is unfinished. | UI tests (uncertain with saved plan → only recovery, saved checklist used; lost connection → locked form, only identical retry; definite failure → no uncertain notice); service test (fresh submission and other assistant refused while `planned`; same information resumes the same key). |
| Confirmed reservation dates cannot be edited | Handover never writes reservation dates (no grant to). The plan stores the confirmed `start_at`/`end_at`; the final loan transaction refuses with 409 "The reservation changed during handover" (guarded undo, no loan) if they differ, so the saved due date is always the confirmed `end_at`. Rescheduling = cancel + new reservation; fulfilled reservations cannot be cancelled or rescheduled (final decisions) — enforced on the reservation side by LJ (S2-01), **not yet implemented** (see the coordination contract). | Service tests (start or end edited after checkout → undo, no loan; retry plans from the current reservation); real PostgreSQL (end date edited by another connection after checkout). |

## Product Owner decisions (confirmed by ZZ)

- **A1 — missing components (RESOLVED).** Handover may proceed with a missing
  component (required or not) if it is clearly disclosed, saved as `missing` with
  its note, and included in the student's confirmation; without confirmation no
  loan is saved. Implemented as:
  - The confirmation box lists every row recorded Missing, with its note
    ("Missing — not being handed over"), and other recorded problems; the
    confirmation sentence states how many missing items the student accepts.
  - Any change to a tick, condition or note after the student confirmed clears
    the confirmation and shows "The student must confirm again"; the form will
    not submit until the student reconfirms.
  - The submission carries `acknowledgedMissing` (the rows shown as missing).
    Loans requires it to equal exactly the rows recorded missing, otherwise 400
    `student_confirmation_required` before any database or Equipment access.
    It is part of the replay fingerprint.
  - Limit: the server proves the confirmation covered the missing *rows* that
    were submitted; that the student actually read the screen is a physical
    process at the counter.
- **A2 — Available equipment (RESOLVED).** An eligible confirmed reservation may
  be handed over while the item is Available. Eligibility is rechecked at
  submission, and duplicate checkout is prevented by: the per-reservation session
  lock; the per-item transaction lock and SC rules (no active loan, exactly one
  eligible reservation) on locked rows before checkout and in the final
  transaction; Equipment's `expectedStatus` check under its item row lock (a
  concurrent status change makes the checkout fail with 409, no loan); and the
  `loans_one_active_per_item` / unique `reservation_id` indexes. The
  cross-service limits below still apply.

## Behaviour

| Rule | Where it is enforced |
| --- | --- |
| Lab assistants only (`lab_assistant`; managers, professors and students are denied) | Page guard, Web gateway (before any service call), Loans route + service |
| Student must confirm (`studentConfirmed: true`) | Loans rejects with 400 `student_confirmation_required` before any database or Equipment access; RLS on new loans also requires `student_confirmed_at` |
| Assistant checked the university ID in person (`universityIdVerified: true`, separate tick) | Loans rejects with 400 `id_verification_required` before any access; RLS on new loans requires `university_id_verified_at` and `university_id_verified_by` |
| SC eligibility (final PO decisions 5 and 6): reservation and equipment in the assistant's lab; `confirmed`; `start_at <= server now < end_at`; no active loan for the item; it is the ONLY confirmed reservation for the item whose window contains now (selected automatically; several → 409, no manual selection) | Loans, on locked rows: when the plan is made, before a new attempt after an undo, and again in the final loan transaction at the server's current time. The common per-item transaction lock (`loans:item:<id>`, taken before the reservation row lock) serializes handovers of different reservations for one item and any reservation writer that follows the coordination contract. Failing at final submission undoes the checkout (ownership-guarded) and returns the failed rule as 409. |
| Successful handover marks the reservation `fulfilled` (final PO decision 2) | Loans final transaction, together with the loan and every pickup record. Needs LJ's `UPDATE (status)` grant; without it Loans refuses before any change with 503 `reservation_fulfillment_unavailable`. |
| Equipment status must be `reserved` or `available` (**PO decision A2**) | Loans (read from Equipment over HTTP); Equipment re-checks it under its row lock at checkout |
| Missing items must be included in the student's confirmation (**PO decision A1**) | Page lists them in the confirmation box and clears confirmation on any edit; Loans requires `acknowledgedMissing` to match the missing rows |
| Checklist = one **main-item** row (`kitComponentId: null`, the kit itself or the non-kit item, with its own explicit condition) **plus**, for kits, every **active** component exactly once (actual IDs); every row ticked; valid condition; notes ≤ 1000 chars | Loans, against Equipment's component list |
| Confirmed reservation dates unchanged during the handover | Loans final transaction compares `start_at`/`end_at` with the plan; a difference is 409 "reservation changed" (guarded undo, no loan) |
| Checklist must match what was shown: the page sends `checklistVersion` (SHA-256 of the canonical component list from Equipment) | Loans recomputes it from Equipment before checkout **and again after checkout**; a mismatch is 409 "component list changed" (after checkout: guarded undo, no records) |
| Borrower is an **active student of the reservation's lab** whose id is the reservation's `borrower_id`, verified through **Users** (`GET /profiles/:id/borrower`) | Loans before checkout and again after checkout. Not found / not a student / other lab / inactive → 409 `borrower_unverified` (after checkout: guarded undo). Users unreachable → 503 `borrower_unavailable` before checkout (nothing changed) or `handover_incomplete` after checkout (durable plan kept for recovery). The page shows the checklist only when Users reports the borrower verified; a displayed name never counts. |

Condition labels → stored values: Good → `good`, Existing damage → `damaged`,
Missing component → `missing`, Needs attention → `unknown`. "Ticked" means
*checked by the assistant*, not *present*: a missing charger is ticked and marked
Missing with its note. No photo is required for existing damage.

On success Loans creates exactly one loan (`due_date` = reservation `end_at`,
`student_confirmed_at` = accepted time), one `phase = 'pickup'` condition
record per row, and marks the reservation `fulfilled` — all in one transaction — for the five-component TC-3.1 kit that is **six** records (main
item + 5 components) — and Equipment moves the item `reserved/available →
checked_out` (Borrowed) through its existing keyed status API. This is the shape
Return already uses (its form shows the main item plus every pickup component,
and it compares each return row with the same pickup row); the real-PostgreSQL
test returns loans created by this handover.

## APIs (shared contracts in `packages/contracts/src/handover.ts`)

- Web `GET /api/handover/:reservationId` → reservation, Equipment name/asset
  code/status, active components, `checklistVersion`, borrower name and
  `identity` (`verified` / `not_verified` / `unavailable`), due date, completed
  handover (if any) and `pending` (`{ state, startedAt, recoverableByYou }`). If
  Equipment components cannot be read the checklist is not shown.
- Web `POST /api/handover/:reservationId` → body
  `{ universityIdVerified, studentConfirmed, acknowledgedMissing, checklistVersion, conditions: [{ kitComponentId, checked, conditionStatus, notes }] }`;
  returns `{ loanId, reservationId, itemId, borrowerId, borrowedAt, dueDate, studentConfirmedAt, universityIdVerifiedAt, status: "checked_out" }`.
- Web `POST /api/handover/:reservationId/recover` (no body) → finish/undo an
  interrupted handover from its stored plan. Web `GET /api/handover` → unfinished
  handovers in the assistant's lab (no borrower or checklist data).
- Loans `GET|POST /handover/:reservationId`, `POST /handover/:reservationId/recover`,
  `GET /handover` (signed `lab_assistant` user only).
- **New Users endpoint** `GET /profiles/:id/borrower` (lab assistant / lab manager,
  same lab only; returns `id, full_name, role, lab_id, is_active`; other labs → 404).
  Users reports facts; Loans and the gateway decide eligibility with the shared
  `isEligibleBorrower` rule.

## Reliability (same protocol as the reviewed return Saga)

1. Session advisory lock per reservation (concurrent submits get 409; Loans keeps
   its existing direct/session-pooled connection requirement). Exact keys, lock
   order and transaction boundaries: "Actual locking" below.
2. Validate, then **commit a durable plan** in `reservations.handover_operation`
   (stable Equipment key, attempt, actor, accepted time, pre-generated loan ID,
   **the normalized checklist and its component version**) *before* contacting
   Equipment. There is no loan yet, so the plan cannot live on the loan as
   `return_operation` does.
3. Equipment checkout with `Idempotency-Key handover:<uuid>:<attempt>:apply` and
   `expectedStatus` = the observed prior status. A lost response is retried with
   the same key; a replayed receipt is re-checked against current status.
4. After checkout, borrower identity (Users) and the component version
   (Equipment) are re-verified, then one local transaction re-checks the SC
   rules on locked rows, inserts the loan and all pickup records and, in the
   same transaction, sets the reservation to `fulfilled`
   together with the completed plan. Double clicks / retries with identical
   input replay the stored result (also after fulfilment and after Return);
   different input or a different assistant gets 409.
5. Only an acknowledged rollback allows undo, guarded by Equipment operation
   ownership (`expectedOperationKey`). Uncertain COMMIT/ROLLBACK, lost undo
   responses or ownership conflicts are reported as
   `handover_state_uncertain` and never compensated blindly. The page then
   re-reads Loans and shows **Handover not finished — outcome uncertain** with
   **Finish interrupted handover** (saved operation) or, when nothing was saved,
   locks the form under **Outcome not confirmed** with **Retry the same
   handover** only. A fresh submission is never possible while the outcome is
   unresolved.

### Interrupted handovers (no silent orphaned checkouts)

Every failure after the plan is saved leaves it visible and recoverable without
the original browser, because the plan stores the checklist:

| Interrupted at | State | Who can finish | What "Finish interrupted handover" does |
| --- | --- | --- | --- |
| Checkout response lost / crash before it was recorded | `planned` | Only the starting assistant (Equipment binds the operation key to them) | Replays the SAME key, then completes or undoes |
| Checkout confirmed; Users/Equipment/DB unavailable or crash before the loan was saved | `applied` | **Any** lab assistant in the lab (no Equipment write is needed to finish) | Re-verifies everything and saves the loan with the original recorder; if now ineligible, only the starter may undo |
| Undo not confirmed (e.g. ownership conflict) | `compensating` | Only the starting assistant | Retries the same undo; never overwrites a later status |
| Undo confirmed | `compensated` | — | Nothing to finish; a new handover (new student confirmation) may start |

The reservation page shows the state and a **Finish interrupted handover** button;
every handover page lists the lab's other unfinished handovers. Recovery is
request-driven (no background worker, like Return): staff must open the page.
Per the PO (JS), durable, retryable recovery is sufficient; no worker and no
further cross-assistant recovery were added, and the existing recovery was kept.
A `planned`/`compensating` operation whose starting assistant is unavailable
still needs manual reconciliation by a lab manager (no tool; accepted scope).
Recovery uses the plan's saved checklist, student confirmation time and
university-ID evidence (`idVerifiedBy` = the starting assistant), never the
browser. Loans never updates or deletes loans or condition records during
handover.

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
- `loans.university_id_verified_at TIMESTAMPTZ` and
  `loans.university_id_verified_by UUID REFERENCES profiles(id) ON DELETE
  RESTRICT` (nullable; existing loans stay NULL), with CHECK
  `loans_university_id_verification_pair` (both NULL or both set). Only who and
  when — no ID number, upload or photo column.
- `reservations.handover_operation JSONB` (nullable).
- Column-level grants to `unitrack_loans_service`: `INSERT (id, item_id,
  borrower_id, reservation_id, lab_id, borrowed_at, due_date,
  student_confirmed_at, university_id_verified_at, university_id_verified_by) ON loans` and `UPDATE (handover_operation) ON
  reservations`. Migration 006 gave Loans no INSERT on `loans`, so handover could
  not work under 006 without this. This migration still gives Loans no way to
  insert `returned_at` or `return_operation`, update reservation status, or
  update/delete condition records. **Fulfilment's `UPDATE (status)` is
  deliberately not here** — it belongs to LJ's S2-01 migration (see "Minimal
  grant / RLS for fulfilment").
- Trigger `loans_student_confirmation_immutable`: `student_confirmed_at` and the
  two university-ID columns cannot be added, changed or cleared after the loan
  row exists (006 gives Loans
  table-level UPDATE on loans). Return's `returned_at`/`return_operation` updates
  are unaffected (verified as the restricted role).
- Two RLS policies (`c430prjct_40_loans_handover_insert` requiring
  `student_confirmed_at`, `university_id_verified_at` and
  `university_id_verified_by` NOT NULL and `returned_at IS NULL`, and
  `c430prjct_40_reservations_handover_update`). These policies are verified
  explicitly, not hidden from 006's checks: `verify_C430PRJCT-40.sql` asserts
  each one by name, table, command and role. It also asserts that 006's
  18-grant / 18-policy matrix is unchanged. The restricted-role PostgreSQL tests
  exercise the insert rule (a loan without confirmation or ID-check evidence →
  42501). `postflight_006_read_only.sql` counts only 006's own policies, so it
  does not cover these additions; their verification lives in this card's
  script. The SQL file's comment about names reflects that scope, not an intent
  to bypass review.
- If the roles do not exist yet (006 not applied), only the columns are added
  and a NOTICE is printed. 006's `REVOKE ALL` also removes column grants, so
  **re-run this file after applying 006**.

**Amended in place, not a follow-up migration.** The file exists only on this
unmerged branch (checked: no other remote branch or `main` contains it), and it
was never applied to shared Supabase by this work. Shared Supabase was not
queried (prohibited), so the **database owner should confirm** with a read-only
query that `loans.student_confirmed_at` does not exist there before applying.
The amended file still upgrades any earlier copy safely: the new columns and
CHECK are added if missing, the insert policy is upgraded with `ALTER POLICY`
(nothing dropped), the trigger is replaced, grants are re-issued. This was
exercised on a local database that had the earlier version applied and a real
handover loan: the loan kept its values (ID-check columns NULL, nothing
backfilled) and a second run was a no-op.

**Full `run.ps1` passed on 2026-11-19 after the fulfilment changes** (fresh container): preflight gates PASS; 003, 004, 005, 006 and this migration (applied twice) verified; static migration compatibility 5/5; existing Equipment/Loans (Return) PostgreSQL suite 3/3; handover PostgreSQL suite 26/26 as restricted roles, **with the SYNTHETIC S2-01 status grant** (not LJ's migration). (Previous full pass: 2026-11-18, 21/21, before fulfilment.)

Shared Supabase was not touched. Verified on disposable PostgreSQL via
`database/local-test/run.ps1` (applies it twice, runs
`verify_C430PRJCT-40.sql` and `services/loans/tests/postgres-handover.integration.test.ts`
as the restricted service roles).

## Reservation fulfilment, locking and the LJ/JS coordination contract

### Final decisions (JS and PO ZZ, 2026-11-19) — RESOLVED

| # | Decision | Handover side (this card) | Reservation side (LJ, S2-01) |
| --- | --- | --- | --- |
| 1 | Reservation writes belong to Loans; LJ owns S2-01 creation and reservation-side protections/permissions; Equipment owns physical status; Web uses service APIs | Handover writes only `reservations.handover_operation` and the single `confirmed → fulfilled` transition in its final transaction. No reservation endpoint, grant or protection added here. | Owns every other reservation write, its migration and grants. |
| 2 | Successful handover → reservation `fulfilled`; fulfilment, loan and all pickup records in ONE database transaction | **Implemented.** Final transaction: loan → every pickup record → `UPDATE … SET status = 'fulfilled', handover_operation = <completed>` → COMMIT. Normal completion and recovery use the same code. | Grant `UPDATE (status)` (see "Minimal grant"). |
| 3 | Fulfilled reservations cannot be cancelled or rescheduled | Handover never leaves `fulfilled`; a `fulfilled` reservation cannot start a new handover. | Refuse every transition from `fulfilled` (contract C4). |
| 4 | Cancellation blocked once a handover starts and while unfinished or uncertain; only safe recovery or confirmed rollback releases it; never a timeout | Persists the operation state on the reservation row before any Equipment change (table below). No timeout exists anywhere in handover. | Check that state under the row lock before cancelling (contract C3). |
| 5 | Pickup eligibility is `start_at <= now < end_at` | **Unchanged** (was already the rule); boundary tests added (eligible at exactly `start_at`; not at exactly `end_at` or 1 ms before `start_at`). | — |
| 6 | Exactly one eligible reservation is selected automatically; several eligible ones BLOCK with a clear conflict message (replaces manual selection) | **Unchanged** (was already blocking): 409 "More than one reservation is eligible for this equipment right now. Ask staff to resolve the overlap." Checked at plan time and in the final transaction; the request cannot choose a reservation (unknown body fields are ignored). | — |
| 7 | Confirmed reservation dates cannot be edited | Handover never writes dates; it compares the confirmed dates in the final transaction and refuses (guarded undo, no loan) if they changed. | Enforce immutability (contract C5). |

These replace the two earlier "UNRESOLVED" items (window end, multiple eligible
reservations) and LJ's earlier note that handover keeps reservations `confirmed`.
**Technical agreement on the contract below and combined testing with LJ's
migration are still pending.**

### Actual locking (inspected in `services/loans/lib/handover/service.ts`)

| Lock | Exact key / statement | Type | Acquired | Released |
| --- | --- | --- | --- | --- |
| L1 per-reservation | `pg_try_advisory_lock(hashtextextended('loans:handover:' \|\| <reservation id, lower case>, 0))` | **Session**-level advisory, **try** only (never waits). Busy → 409 "A handover is already in progress…" | First statement of every submit and recover request, on one pooled connection held for the whole request | `pg_advisory_unlock` in `finally`. If COMMIT, ROLLBACK or the unlock itself fails, the connection is destroyed (`release(true)`) and PostgreSQL releases the lock when that session ends. |
| L2 common per-item | `pg_advisory_xact_lock(hashtextextended('loans:item:' \|\| item_id::text, 0))` (JS: `itemLockKey()`; `uuid::text` is lower case) | **Transaction**-level advisory, blocking | First lock in every handover transaction (T1, T2, T3) | COMMIT / ROLLBACK |
| L3 reservation row | `SELECT … FROM public.reservations WHERE id = $1 AND lab_id = $2 FOR UPDATE` | Row lock | Immediately after L2 | COMMIT / ROLLBACK |

The item ID used for L2 is read without a lock (`SELECT item_id …`) only to name
the lock; if the row locked by L3 has a different item, the request fails with
409 "The reservation changed during handover". (The previous order — row, then
item lock inside the eligibility check, key `loans:handover:item:<id>` — was
changed so that reservation writers can share one lock order.)

Transaction boundaries of one request:

1. **T1 (plan):** BEGIN → L2 → L3 → validate stored operation, existing loan,
   completed replay → `has_column_privilege('public.reservations', 'status',
   'UPDATE')` (missing → 503 `reservation_fulfillment_unavailable`, nothing
   written) → SC eligibility counts → Users and Equipment HTTP reads **while
   holding L2+L3** → write plan `planned` → COMMIT.
2. **Equipment checkout** over HTTP (only L1 held). Then `applied` is written by
   one autocommit `UPDATE` (brief row lock, no advisory lock).
3. **Re-verification** of the borrower (Users) and component version
   (Equipment) over HTTP (only L1 held).
4. **T2 (final, atomic):** BEGIN → L2 → L3 → same item, borrower, lab and
   confirmed dates; SC eligibility at the server's current time → INSERT loan →
   INSERT every pickup record → `UPDATE reservations SET status = 'fulfilled',
   handover_operation = <completed> WHERE id, lab_id, item_id, borrower_id AND
   status = 'confirmed'` (must affect exactly one row) → COMMIT. Any error before
   COMMIT → ROLLBACK removes all of it, then the guarded undo (T3).
5. **T3 (undo, only after an acknowledged ROLLBACK):** `compensating`
   (autocommit) → BEGIN → L2 → L3 → no loan for the reservation → Equipment undo
   over HTTP **while holding L2+L3** → `compensated` → COMMIT.

**Release and recovery.** A failed COMMIT is never compensated: the outcome is
reported as `handover_state_uncertain`, the connection is destroyed, and the
next request (same submission or **Finish interrupted handover**, `POST
/handover/:id/recover`) reads the committed truth. Because T2 is one
transaction, that truth is exactly one of: `fulfilled` + `completed` + loan +
all pickup records, or `confirmed` + `applied` + none of them. Recovery runs the
same T2 from the stored plan (checklist, confirmation and ID-check evidence),
never from the browser.

**Deadlock risk (reduced, not eliminated).** L1 never waits. Every handover
transaction takes L2 then L3, and the autocommit state writes take only a row
lock. A reservation writer that follows the same order (C1, C2 below) removes
the lock-order cycle between these two locks, which **reduces** deadlock risk.
It does not rule deadlocks out: other locks (foreign-key checks, other tables,
a writer that does not follow the order, several items) can still form a
cycle. PostgreSQL then detects it and aborts one transaction (SQLSTATE 40P01).
For handover that is an ordinary failed transaction: the plan or final
transaction rolls back and the existing guarded paths apply. Reservation
writers must handle it as a retryable error. Cost: while T1 or T3 holds L2/L3,
a writer for the same item waits for those HTTP calls (Equipment/Users time
out after 3 s each).

### Persisted operation states (`reservations.status` + `handover_operation ->> 'state'`)

| `status` | state | Meaning | May the reservation be cancelled / rescheduled? |
| --- | --- | --- | --- |
| `pending` (or any not-yet-confirmed status) | NULL | Not eligible for handover; handover never starts on it | Yes — under LJ's own rules; this contract adds nothing |
| `confirmed` | NULL | No handover started | Yes (LJ's normal rules) |
| `confirmed` | `planned` | Plan committed; Equipment checkout **may or may not** have happened (uncertain) | **No** |
| `confirmed` | `applied` | Equipment checked the item out; loan not yet saved | **No** |
| `confirmed` | `compensating` | Undo started but not confirmed (e.g. ownership conflict) | **No** |
| `confirmed` | `compensated` | Undo **confirmed**: Equipment restored, no loan, nothing in progress | **Yes — restriction released** |
| `fulfilled` | `completed` | Loan and every pickup record committed with fulfilment | **Never** (decision 3) |

**When cancellation of a confirmed reservation may safely resume:** only
when, on the row locked under L2 → L3, the state is NULL or `compensated`, and
no `loans` row has this `reservation_id`. Cancelling a `pending` reservation is
not affected by handover and stays allowed under its own rules. A `planned`, `applied` or `compensating`
operation is released only by **Finish interrupted handover** — which ends in
`completed` (→ `fulfilled`, never cancellable) or `compensated` (cancellable) —
or by a lab manager's reconciliation (no tool; existing accepted scope). No
timeout, age or session end releases it.

### Coordination contract for LJ (S2-01) — proposed; technical agreement PENDING

- **C1 — common per-item lock.** Every Loans transaction that creates,
  confirms, cancels, expires or otherwise changes a reservation's status first
  takes `pg_advisory_xact_lock(hashtextextended('loans:item:' || item_id::text, 0))`
  (for a create: the requested item). If a transaction ever needs several
  items, lock them in ascending `item_id` order. Never take
  `loans:handover:<id>` (handover's private session lock).
- **C2 — then the reservation row:** `SELECT … FOR UPDATE`, and check that its
  `item_id` is the one locked in C1.
- **C3 — cancel / expire / un-confirm a CONFIRMED reservation** only if, on
  that locked row, `handover_operation IS NULL OR handover_operation ->>
  'state' = 'compensated'`, and no `loans` row has this `reservation_id`.
  Otherwise refuse (suggested 409: "A handover for this reservation is in
  progress or finished. Finish or undo it first."). A `pending` reservation
  can never have a handover; cancelling it remains allowed under LJ's own
  rules and is not restricted by this contract.
- **C4 — `fulfilled` is terminal** and written only by handover's final
  transaction.
- **C5 — confirmed details immutable:** `item_id`, `borrower_id`, `lab_id`,
  `start_at`, `end_at` (decision 7; rescheduling = cancel + new, allowed only
  under C3).
- **C6 — never write `handover_operation`.**
- **C7 — PROPOSAL ONLY, requires LJ/JS review (not agreed, not implemented):**
  a `fulfilled` reservation leaves S2-02's `WHERE (status = 'confirmed')`, so a
  new booking could overlap the window of equipment that is out on loan. One
  option is extending the constraint to `WHERE (status IN ('confirmed',
  'fulfilled'))`. The review must cover early returns: with that change a
  fulfilled window keeps blocking re-booking after the item comes back early
  (Return does not change the reservation), and it does not cover a loan that
  runs past `end_at`. Alternatives (e.g. relying on handover's active-loan check
  only, or ending the fulfilled window at return) are for LJ/JS to weigh.

Why both commit orders are safe for a confirmed reservation: handover T2 and a
C1–C3 cancel serialize on L2 (and L3). If the cancel commits first, T2 sees `cancelled` and refuses
(guarded undo, no loan — tested). If T2 commits first, the cancel sees
`fulfilled` + loan and refuses. If the cancel runs while the state is
`planned`/`applied`/`compensating`, it refuses. Only `compensated` lets it
through, when Equipment is already restored and no loan exists.

Optional database backstop for LJ's migration (illustrative, **untested**,
`SECURITY INVOKER`, it reads `loans` with Loans' existing SELECT grant):

```sql
-- PROPOSAL ONLY. Untested. Owner: LJ (S2-01).
CREATE OR REPLACE FUNCTION public.reservations_handover_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'fulfilled' AND NEW.status IS DISTINCT FROM 'fulfilled' THEN
    RAISE EXCEPTION 'A fulfilled reservation cannot change status';
  END IF;
  IF NEW.status = 'fulfilled' AND OLD.status IS DISTINCT FROM 'fulfilled'
     AND (OLD.status <> 'confirmed'
          OR NOT EXISTS (SELECT 1 FROM public.loans WHERE reservation_id = NEW.id)) THEN
    RAISE EXCEPTION 'Only a confirmed reservation with its loan can become fulfilled';
  END IF;
  IF NEW.status IN ('cancelled', 'expired', 'pending') AND OLD.status = 'confirmed'
     AND OLD.handover_operation ->> 'state' IN ('planned', 'applied', 'compensating') THEN
    RAISE EXCEPTION 'A handover for this reservation is unfinished';
  END IF;
  IF OLD.status = 'confirmed'
     AND (NEW.item_id, NEW.borrower_id, NEW.lab_id, NEW.start_at, NEW.end_at)
         IS DISTINCT FROM (OLD.item_id, OLD.borrower_id, OLD.lab_id, OLD.start_at, OLD.end_at) THEN
    RAISE EXCEPTION 'Confirmed reservation details cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
```

The fulfilment rule is compatible with handover because T2 inserts the loan and
pickup records before the status update in the same transaction. Every rule
needs explicit verification in S2-01's own script plus restricted-role tests.

### Minimal grant / RLS for fulfilment — dependency on LJ

- **Needed:** exactly `GRANT UPDATE (status) ON public.reservations TO
  unitrack_loans_service;` — no table-level grant, no other column, no other
  role.
- **RLS:** no new policy is needed for handover. The S2-09 migration's
  `c430prjct_40_reservations_handover_update` (`FOR UPDATE TO
  unitrack_loans_service USING (true) WITH CHECK (true)`) already covers UPDATE
  commands by that role; policies are per command, not per column. If LJ adds a
  narrower policy, permissive policies are OR-ed, so narrowing needs a
  `RESTRICTIVE` policy or the trigger above, and must still allow handover's
  `confirmed → fulfilled` update and its `handover_operation` updates on
  `confirmed` rows.
- **Not in the S2-09 migration** (LJ owns reservation-write permissions; no
  duplication, no broadening). `verify_C430PRJCT-40.sql` still asserts that the
  S2-09 migration alone grants no status update.
- **Until LJ's grant exists, no handover can complete on any database.** Loans
  refuses at plan time with 503 `reservation_fulfillment_unavailable` ("Handover
  is not available yet: reservations cannot be marked fulfilled. Nothing was
  changed.") before any plan, Users or Equipment call; the page shows it as a
  definite failure, not an uncertain one. If the grant disappears after
  checkout, T2 rolls back and the checkout is undone (`handover_rolled_back`).
  **Deployment order:** LJ's migration before (or with) enabling S2-09.
- **Local tests only:** `database/local-test/SYNTHETIC_s2-01_reservation_status_grant.sql`
  contains just that grant and is applied by the PostgreSQL handover test and
  `handover-manual.ps1`. It is a clearly marked stand-in, **not** LJ's migration;
  passing tests with it does not verify her migration.

### Return and pickup-lookup compatibility

- Return reads the loan and its pickup records by `loan_id` (unchanged) and
  writes no reservation. A returned loan's reservation stays `fulfilled`.
- Return's `hasActivePickup` counts only `confirmed` reservations and excludes
  the loan's own reservation, so a `fulfilled` reservation never makes a
  returned item `reserved`.
- SC's pickup lookup on `main` filters `confirmed`, so a fulfilled reservation
  no longer appears as pending pickup (correct after handover).
- Tested on PostgreSQL: TC-3.1 and TC-3.5 return handover loans with the
  existing Return service; after Return the reservation is still `fulfilled`
  and a retried handover returns the same result without writing anything.

### Tests for these decisions

- **Unit (modelled database):** fulfilment written after the loan and all six
  pickup records in one BEGIN…COMMIT; fulfilment failure (error or zero rows) →
  loan and records rolled back, checkout undone, reservation `confirmed`, retry
  completes; uncertain COMMIT before/after → never fulfilled without loan and
  records, or the reverse; recovery fulfils atomically, or rolls back and undoes;
  completed retries (submit, recover, after Return) return the same result and
  write nothing; `completed` on a non-fulfilled reservation → uncertain;
  `fulfilled` reservation cannot start a handover; missing grant → 503 before
  any access (also after a confirmed undo); eligibility boundaries; several
  eligible → blocked; lock order and keys.
- **Real PostgreSQL, restricted roles + SYNTHETIC grant:** fulfilment in TC-3.1
  and recovery; grant revoked after checkout → full rollback + undo, then the
  reference cancel succeeds only at `compensated`; a **synthetic deferred fault
  trigger** fails the final COMMIT → `confirmed`/`applied`, no loan or records,
  cancel blocked, recovery then fulfils everything; S2-09 migration alone → 503
  before any Equipment change; a writer holding the SQL-form key
  `'loans:item:' || item_id::text` blocks handover until it commits (proves the
  key matches across JS and SQL); the reference `cancelUnderContract` sketch is
  blocked during `planned`/`applied` and after `fulfilled`. These exercise the
  **proposed** contract only, not LJ's implementation.
- **Web:** `reservation_fulfillment_unavailable` shown as a definite failure; a
  completed handover on a `fulfilled` reservation renders as completed.

### Pickup lookup (no duplicate)

`main` already has SC's lookup: Loans `GET /reservations/pickup?itemId=` (lab
assistant, own lab; `services/loans/lib/reservations/pickup-query.ts`) behind Web
`GET /api/reservations/pickup`. Its rules match this card's: `confirmed`,
`start_at <= now < end_at`, no active loan, exactly one eligible reservation
(`multipleEligibleReservations` blocks). The scan page links to
`/handover/${reservation.id}` — the same route as this card — but that button is
**disabled on `main` "until S2-09 is integrated"**. This card adds no lookup;
re-enabling the link is SC's change after this PR merges. The pickup lookup is a
point-in-time read; the handover service re-checks everything on locked rows.

### S2-02 (LJ, unmerged) — fixture adaptation still needed after it merges

LJ's `feature/S2-02-no-double-booking` (`d90cf11`, unchanged on 2026-11-19, not
applied to shared Supabase) adds `reservations_no_overlapping_confirmed EXCLUDE
USING gist (item_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE
(status = 'confirmed')`. After it merges: resolve the one-line
`database/local-test/run.ps1` conflict (both add steps after 006), and replace
this card's PostgreSQL fixtures that insert overlapping `confirmed` rows (the
two-eligible-reservations test and the `finalOverlap` case) with an assertion
that the database rejects the overlap during a handover; the multiple-eligible
rule stays covered by the unit tests. See C7 for `fulfilled`.

### Other remaining limits (unchanged)

1. **Users and Equipment checks are point-in-time HTTP reads.** A borrower
   deactivated or a kit component changed between the post-checkout re-check and
   the loan COMMIT is not detected (window of one local transaction).
2. **Equipment and Loans commit separately.** A crash between Equipment checkout
   and the loan COMMIT leaves an `applied` plan, visible and recoverable, never a
   silent orphan; recovery is request-driven.

## Shared changes to coordinate

- **Users (new endpoint):** `services/users/app/profiles/[id]/borrower/route.ts`
  — staff-only, same-lab, minimal projection. Needs the Users owner's review.
- **Loans configuration:** Loans now needs `USERS_SERVICE_URL` (added to
  `services/loans/.env.example`; each developer adds it to their own
  `.env.local`, and every Loans deployment needs it). Missing → handover fails
  closed with 503 `loans_configuration`.

- `packages/contracts`: new `handover.ts`; `LOANS_ERROR_CONTRACT` gains handover
  messages/codes (existing entries unchanged).
- `services/loans/lib/equipment-http.ts`: private request helper hoisted to module
  level so a handover adapter can reuse it; return adapter behaviour, messages
  and `getComponents` are unchanged.
- `services/loans/lib/errors.ts`: adds `handoverUncertain()`.
- `database/local-test/run.ps1`: two additive steps for this migration and test.
- `database/local-test/SYNTHETIC_s2-01_reservation_status_grant.sql`: test-only
  stand-in for LJ's status grant (used by the handover PostgreSQL test and the
  manual harness; never a migration).
- `apps/web/lib/handover-view.ts`: `reservation_fulfillment_unavailable` is a
  definite (not uncertain) failure.
- No navigation, login, seed, Return, reservation, scan or lookup changes.

## Manual browser testing (disposable database, restricted accounts)

`database/local-test/handover-manual.ps1 -Action Setup -AssistantId <your
Supabase user ID> -AssistantEmail <your email>` starts a local container, applies
003-006 and this migration, creates `unitrack_{users,equipment,loans}_local`
LOGIN accounts that only inherit their 006 group roles
(`manual_service_logins.sql`), and loads `handover_manual_fixture.sql`. Then run
`-Action Run -Service users|equipment|loans` in three terminals. Setup also
applies the SYNTHETIC S2-01 status grant (to `unitrack_loans_service`; the
`unitrack_loans_local` login inherits it) so the handover can mark the
reservation fulfilled, then runs `manual_fulfilment_permission_check.sql`: the
Loans login must be able to run the fulfilment update (rolled back) and must
have nothing broader (no table-level UPDATE, no date/item/borrower/lab column,
nothing for the Users/Equipment logins). This stand-in is local only and is not
LJ's migration (see "Minimal grant / RLS for fulfilment"). Setup refuses to
reuse any existing manual container, running or stopped: each service
connects with its OWN restricted account (never the container superuser), and the
script restores the terminal's `DATABASE_URL`/`LOANS_DATABASE_SESSION_AFFINITY`
when it exits. Start Web normally. `-Action Teardown` removes everything.
`.env.local` files are never read or edited.

### Browser acceptance results (disposable database only)

| Case | Result | Evidence (read-only queries on the local container) |
|---|---|---|
| TC-3.1 (re-run 2026-11-18, after the review fixes and A1/A2) | Pass | Reservation `…9921`: exactly **1** loan (borrower `…9902`, due date set, `student_confirmed_at` set, not returned); **6** `pickup` records = **1** main-item record (`kit_component_id` NULL) + **5** distinct records for the kit's 5 active components (Charger, Cable, Battery, Case, Tripod), all `good`, same lab, recorder set; item `checked_out`; plan state `completed`; 1 active loan on the item. |
| TC-3.1 … TC-3.7 with the university-ID checkbox (and now fulfilment) | **Pending (NH) — not run yet** — needs a fresh `handover-manual.ps1 -Action Setup` (the earlier manual database predated the ID columns and fulfilment) | Automated coverage only; full `run.ps1` passes (2026-11-19). |
| TC-3.4, TC-3.5, TC-3.7 | Pass (before the review fixes) | Missing charger saved as `missing` with its note; existing damage saved as `damaged` with its note and no photo; without confirmation the reservation stayed reserved and no loan was saved. Since then covered by the automated A1 and confirmation tests above; not re-run in the browser. |

Shared Supabase was not used; no shared migration was applied.

## Open questions

- **Resolved (JS + PO ZZ, 2026-11-19):** reservation writes in Loans (LJ),
  fulfilment in one transaction, fulfilled not cancellable/reschedulable,
  cancellation blocked while a handover is unfinished or uncertain, eligibility
  `start_at <= now < end_at`, automatic single selection with multiple eligible
  reservations blocking, immutable confirmed dates. Earlier: identity, recovery
  scope, uncertain-outcome UI (table at the top).
- **Pending technical agreement (LJ/JS):** the coordination contract C1–C6 and
  the minimal grant.
- **Proposal needing review (LJ/JS):** C7 — whether and how S2-02's overlap
  constraint should cover `fulfilled` reservations, including early-return
  behaviour.
- **Dependency (LJ, S2-01 migration):** `GRANT UPDATE (status) ON
  public.reservations TO unitrack_loans_service`. Without it no handover can
  complete (503 `reservation_fulfillment_unavailable`, nothing changed).
- **Pending combined testing:** S2-09 with LJ's real migration and S2-01
  endpoints on a disposable database (cancel vs. handover in both commit orders,
  every state in the table, fulfilled terminal, immutable dates), and the S2-02
  fixture adaptation. Until then this card's results cover only the synthetic
  stand-in and the reference sketch.
- **Pending browser acceptance (NH):** TC-3.1 … TC-3.7 with the university-ID
  checkbox and fulfilment on a fresh manual database.
- **Equipment owner (component versioning):** the post-checkout component check
  narrows but cannot remove the window before the loan COMMIT (no distributed
  transaction). Equipment has no API that edits kit components today. If one is
  added, agree a version/lock contract.
- **SN (custody):** future loan-update protection must still allow Loans to INSERT
  handover loans and UPDATE `reservations.handover_operation` (and, with LJ's
  grant, `status` to `fulfilled`).
