# Handover — S2-09 / C430PRJCT-40 (NH)

Kit checklist, condition and student confirmation. A lab assistant opens
`/handover/[reservationId]`, ticks every row, records a condition (a note is
required for Missing component and Existing damage, optional otherwise), checks the student's university ID card in person and ticks the ID check,
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
| **Note required** for every row recorded Missing component (`missing`) or Existing damage (`damaged`): omitted, `null`, empty and whitespace-only notes are refused; Good and Needs attention keep notes optional (PR #24 review correction) | One shared rule in contracts (`hasRequiredHandoverNote`). Page: label switches to "Notes (required)", a hint shows until text is entered, and the form refuses to send. Loans: 400 `invalid_handover` "Add a note to every row marked Missing component or Existing damage." before any database, Users or Equipment access. Every **stored plan** is checked too (`validOperation`), so replay, Finish interrupted handover, recovery by another assistant and re-planning after an undo cannot save such a row; a stored plan that fails it is `handover_state_uncertain` for staff, never finished. |
| Confirmed reservation dates unchanged during the handover | Loans final transaction compares `start_at`/`end_at` with the plan; a difference is 409 "reservation changed" (guarded undo, no loan) |
| Checklist must match what was shown: the page sends `checklistVersion` (SHA-256 of the canonical component list from Equipment) | Loans recomputes it from Equipment before checkout **and again after checkout**; a mismatch is 409 "component list changed" (after checkout: guarded undo, no records) |
| Borrower is an **active student of the reservation's lab** whose id is the reservation's `borrower_id`, verified through **Users** (`GET /profiles/:id/borrower`) | Loans before checkout and again after checkout. Not found / not a student / other lab / inactive → 409 `borrower_unverified` (after checkout: guarded undo). Users unreachable → 503 `borrower_unavailable` before checkout (nothing changed) or `handover_incomplete` after checkout (durable plan kept for recovery). The page shows the checklist only when Users reports the borrower verified; a displayed name never counts. |

Condition labels → stored values: Good → `good`, Existing damage → `damaged`,
Missing component → `missing`, Needs attention → `unknown`. "Ticked" means
*checked by the assistant*, not *present*: a missing charger is ticked and marked
Missing with its note. Missing component and Existing damage always need a
note that says what is missing or damaged. No photo is required for existing
damage.

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
serialized by the advisory lock. Two overlapping **confirmed** reservations for
one item can no longer exist (LJ's S2-02 exclusion constraint, merged in PR #26);
any remaining race between handovers of one item still meets the per-item lock,
Equipment's `expectedStatus` check and `loans_one_active_per_item`, so exactly
one wins and the loser never applied anything to undo. Real-PostgreSQL tests
cover both later-change cases, concurrent submissions, and an overlapping
confirmed insert by another connection during a handover (refused by S2-02; the
handover completes). Relies on migration 005 being applied (owner-reported on
shared Supabase).

Dev-mode note: Loans waits 3 s for Equipment (same adapter as Return). The first
request to an Equipment route under `next dev` can take longer while it
compiles; Loans then reports `handover_state_uncertain` (nothing is saved, or the
retry replays the same key). Use **Retry the same handover**.

## Migration — `database/migrations/C430PRJCT-40_S2-09_handover_confirmation.sql`

Apply **after 006 and S2-02, and before migration 007**, by the database owner,
in a controlled step. Not run by the app. Additive and idempotent:

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
  row exists. Migration 007 later removes Loans' table-level UPDATE and permits
  only `returned_at`/`return_operation`; this trigger remains installed as
  defence in depth. Return updates are unaffected (verified as the restricted
  role before and after 007).
- Two RLS policies (`c430prjct_40_loans_handover_insert` requiring
  `student_confirmed_at`, `university_id_verified_at` and
  `university_id_verified_by` NOT NULL and `returned_at IS NULL`, and
  `c430prjct_40_reservations_handover_update`). These policies are verified
  explicitly, not hidden from 006's checks: `verify_C430PRJCT-40.sql` asserts
  each one by name, table, command and role. Before 007 it asserts 006's
  18-grant / 18-policy matrix; after 007 it requires the intended 17 table grants,
  18 policies, and column-only Return UPDATE access. The restricted-role PostgreSQL tests
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

**Full `run.ps1` passed on 2026-11-19 after merging `main` (PR #26, S2-02) and the review corrections** (fresh container, the ACTUAL merged migration files): preflight gates PASS; 003, 004, 005, 006 verified; **LJ's real `S2-02_no_double_booking.sql`** applied and `verify_S2-02.sql` PASS; this migration applied twice and `verify_C430PRJCT-40.sql` PASS; `verify_S2-02.sql` re-run PASS (constraint untouched); static migration compatibility 6/6; Equipment/Loans PostgreSQL suite (including LJ's S2-02 test) 4/4; handover PostgreSQL suite 26/26 as restricted roles.

**Combined S2-02 + S2-09 + S2-13 run passed on 2026-11-19 after integrating
main through PR #27.** The fresh disposable database applied S2-09 before 007;
`verify_C430PRJCT-40.sql` passed both before and after 007; migration 007 and
its final-row/ACL verification passed; static migration tests were 6/6;
Equipment/Loans PostgreSQL tests were 6/6; and restricted-role handover tests
were 26/26. The runner builds the current shared contracts first, so its
`canonicalChecklist` runtime export cannot come from stale package output.

What that run does and does not prove:

- **Real integration evidence:** S2-02's exclusion constraint (LJ's actual
  migration) together with this migration and the handover service on real
  PostgreSQL: overlapping confirmed inserts and promotions are refused with
  23P01, including one committed by another connection mid-handover; the
  handover completes and is fulfilled once.
- **Still SYNTHETIC:** marking the reservation `fulfilled` uses
  `SYNTHETIC_s2-01_reservation_status_grant.sql`, because no S2-01 migration
  with `GRANT UPDATE (status)` exists on `main` or any remote branch (checked
  2026-11-19). Every fulfilment result in this suite therefore depends on that
  stand-in, and the cancel/lock checks use the reference `cancelUnderContract`
  sketch, **not** LJ's code. The permission/locking dependency is **not
  resolved**.

(Earlier passes: 2026-11-19 before the merge, 26/26 with S2-09 only; 2026-11-18, 21/21, before fulfilment.)

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

### Coordination contract for LJ (S2-01) — C1-C6 confirmed technical requirements

C1-C6 are the agreed integration requirements for LJ's S2-01 implementation.
S2-09 documents and tests its side of the contract but does not implement LJ's
reservation endpoints, guards, or production grant.

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
- **C7 — OUT OF SCOPE (not agreed and not implemented by S2-09):**
  a `fulfilled` reservation leaves S2-02's `WHERE (status = 'confirmed')`, so a
  new booking could overlap the window of equipment that is out on loan. One
  option is extending the constraint to `WHERE (status IN ('confirmed',
  'fulfilled'))`. The review must cover early returns: with that change a
  fulfilled window keeps blocking re-booking after the item comes back early
  (Return does not change the reservation), and it does not cover a loan that
  runs past `end_at`. Alternatives (e.g. relying on handover's active-loan check
  only, or ending the fulfilled window at return) require separate Product
  Owner and technical work outside this integration.
  **Observed with LJ's merged S2-02 (real PostgreSQL, 2026-11-19):** after a
  handover marks a reservation `fulfilled`, an overlapping reservation for the
  same item CAN be confirmed (the constraint no longer sees the fulfilled row);
  handing it over is still refused ("This equipment is already on loan.") while
  the loan is active. The test asserts the current behaviour so it fails loudly
  if S2-02 is extended; C7 itself remains a proposal.

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
- **Note requirement (review correction):** Loans unit tests refuse
  missing/damaged × kit component/main item × omitted/`null`/empty/spaces/
  tabs-and-newlines (20 cases) with 400 before any database, Users or Equipment
  access; one blank note among valid problem rows refuses the whole handover;
  Good/Needs attention stay optional. Stored-plan tests blank the note inside a
  `planned`, `applied` and `compensated` plan: recovery by the starter, recovery
  by another assistant, exact resubmission and re-planning all end
  `handover_state_uncertain` with no records and no new Equipment call. Gateway
  tests (form bypassed) get the same 400 and approved message with no Users or
  Equipment request. UI tests: required label/hint/`aria-required` only for the
  two conditions; blank and whitespace-only notes are not sent even when both
  boxes are ticked; adding the note clears the confirmation, and after
  reconfirming the note is saved. Each layer was checked by temporarily
  removing it: the corresponding tests failed.

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

### S2-02 (LJ) — merged in PR #26; fixtures adapted

`main` now contains LJ's `S2-02_no_double_booking.sql` (`d90cf11`, merged as
`9825f6d`): `reservations_no_overlapping_confirmed EXCLUDE USING gist (item_id
WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status =
'confirmed')`. This branch merged `origin/main` and:

- `database/local-test/run.ps1` keeps both sequences: S2-02 + `verify_S2-02.sql`
  (production order: it is already on `main`), then this migration twice +
  `verify_C430PRJCT-40.sql`, then `verify_S2-02.sql` again, then 007 and both
  custody and S2-09 verification. `handover-manual.ps1` uses the same production
  order so browser checks use the merged schema and final restricted ACL.
- The PostgreSQL fixtures no longer insert a second overlapping `confirmed`
  reservation (the constraint correctly rejects it; it is not disabled).
  Instead: the overlap reservation is seeded `pending`; the test asserts that
  both inserting and promoting an overlapping confirmed reservation fail with
  23P01 on `reservations_no_overlapping_confirmed`, that the pending one is
  refused for handover, and that concurrent submissions create one loan. The
  former `finalOverlap` case now has another connection try to commit an
  overlapping confirmed reservation between checkout and the final
  transaction: S2-02 refuses it and the handover completes.
- The SC "several eligible → BLOCK" rule cannot be reached on a database with
  S2-02 (two confirmed windows that both contain `now` always overlap). Loans
  keeps it as defence in depth; it stays covered by the modelled-database unit
  tests (plan time and final transaction).
- See C7 for `fulfilled` (observed behaviour recorded there).

### S2-13 custody protection — merged in PR #27; compatibility verified

Migration 007 runs after S2-09. It revokes 006's table-level Loans UPDATE and
grants only `UPDATE (returned_at, return_operation)`, while leaving S2-09's
column-level handover loan INSERT and reservation permissions intact. The
student-confirmation/ID-evidence trigger and 007's loan/condition triggers all
remain enabled. Restricted-role tests prove handover creation, evidence denial,
condition immutability, valid Return completion/replay, compensation/retry, and
the deferred final-return invariant together.

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
  messages/codes (existing entries unchanged), including "Add a note to every row
  marked Missing component or Existing damage." (code `invalid_handover`).
- `services/loans/lib/equipment-http.ts`: private request helper hoisted to module
  level so a handover adapter can reuse it; return adapter behaviour, messages
  and `getComponents` are unchanged.
- `services/loans/lib/errors.ts`: adds `handoverUncertain()`.
- `database/local-test/run.ps1`: additive steps for this migration and test,
  merged with S2-02's steps (see "S2-02"); `handover-manual.ps1` applies S2-02.
- `database/local-test/SYNTHETIC_s2-01_reservation_status_grant.sql`: test-only
  stand-in for LJ's status grant (used by the handover PostgreSQL test and the
  manual harness; never a migration).
- `apps/web/lib/handover-view.ts`: `reservation_fulfillment_unavailable` is a
  definite (not uncertain) failure.
- No navigation, login, seed, Return, reservation, scan or lookup changes.

## Manual browser testing (disposable database, restricted accounts)

`database/local-test/handover-manual.ps1 -Action Setup -AssistantId <your
Supabase user ID> -AssistantEmail <your email>` starts a local container, applies
003-006, S2-02, this migration, and 007 in production order, verifies S2-09
before and after 007, and creates `unitrack_{users,equipment,loans}_local`
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

**Run of 2026-11-19 (NH)** — fresh `handover-manual.ps1 -Action Setup` with
migrations 003–006, the S2-09 migration and the **SYNTHETIC local S2-01 status
grant** (not LJ's migration). Every service connected as its restricted local
login. "Browser" lists only what NH reported seeing; "Database" lists
read-only queries on the local container (`BEGIN READ ONLY`) after the runs.

| Case | Reservation | Browser (as reported by NH) | Database (read-only, local) | Result |
|---|---|---|---|---|
| TC-3.1 | `…9921` (kit, 5 components) | Borrowed; six Good pickup rows | `fulfilled`, plan `completed`; exactly 1 loan for the reservation and the item, not returned, borrower = reservation's; `student_confirmed_at` set; ID check at/by set, verifier = the lab assistant; 6 `pickup` rows = main item + Charger, Cable, Battery, Case, Tripod, all `good`, no notes, recorder = the assistant, recorded at the borrow time; one `reserved → checked_out` history row with a first-attempt key | **Pass** |
| TC-3.4 | `…9922` (kit) | Borrowed; Charger Missing with note "missing charger" | `fulfilled`, `completed`; 1 loan; ID evidence as above; 6 `pickup` rows: Charger `missing`, note "missing charger"; main item + 4 other components `good`; one checkout history row | **Pass** |
| TC-3.5 | `…9923` (non-kit) | Borrowed; one main-item Existing damage row with its note (NH's screenshot) | `fulfilled`, `completed`; 1 loan; ID evidence as above; exactly 1 `pickup` row: main item, `damaged`, note "Scrashing on casing" (stored as entered); no photo; one checkout history row | **Pass** |
| TC-3.7 refusals | `…9925` (kit, extra local reservation added to the manual database for this re-test) | Not submitted with the student confirmation missing; not submitted with the ID check missing | `confirmed`, no handover plan, item `reserved`; 0 loans, 0 condition records, 0 status-history rows for the item | **Pass** |
| TC-3.7 completion | `…9924` (kit) | Completed with both boxes ticked (NH) | `fulfilled`, `completed`; 1 loan; ID evidence as above; 6 `pickup` rows, all `good`; one checkout history row | Completed (observed) |

Across the lab (read-only): 0 duplicate pickup rows per loan/component, 0
non-pickup rows, 0 loans without a reservation, 4 active loans (one per
handed-over item).

**Not confirmed in the browser in this run** (covered by automated tests only):
confirmation reset after editing a row, page reload / retry of a completed
handover, the uncertain-outcome and "Finish interrupted handover" screens, and
Return of these loans.

### Focused B1-B4 browser re-check results after note validation

**Run of 2026-11-19 (JS):** JS executed all four required manual acceptance
tests on a fresh isolated `handover-manual.ps1 -Action Setup`. The setup applied
S2-02, S2-09 and S2-13 in production order and used the **SYNTHETIC local S2-01
status grant** so the restricted Loans login could fulfil reservations. This
grant was test-only, was not applied to shared Supabase, and is not a substitute
for LJ's real S2-01 migration and locking integration, which remain pending.

| Case | Reservation | JS browser result | Read-only local database result | Result |
|---|---|---|---|---|
| B1 | `…9922` (kit) | Empty note for Charger marked Missing component was rejected | Reservation remained `confirmed`, Equipment remained `reserved`, and there were 0 loans | **Pass** |
| B2 | `…9922` | Whitespace-only missing-component note was rejected | Same persisted state as B1: `confirmed`, `reserved`, 0 loans | **Pass** |
| B3 | `…9922` | Valid note `Charger not in the case` was accepted | Exactly 1 loan and 6 pickup records (main item plus five components); reservation `fulfilled`; handover operation `completed`; Equipment `checked_out`; student-confirmation and university-ID-verification evidence persisted | **Pass** |
| B4 | `…9923` (non-kit) | Existing damage with an empty note was rejected; after entering `Crack on front casing`, the handover was accepted | Exactly 1 loan and 1 damaged pickup record with the valid note; reservation `fulfilled`; handover operation `completed`; Equipment `checked_out`; student-confirmation and university-ID-verification evidence persisted | **Pass** |

The final persisted-result verifier
`verify_handover_browser_b1_b4.sql` also passed after B3 and B4. It verified the
database results independently of the browser observations. Optional B5 was not
part of the requested B1-B4 acceptance run and is not recorded as passed.

The scan page's "Proceed to Handover" link is still disabled on `main` (SC), so
the dedicated `/handover/<reservation id>` routes were used directly.

Dedicated local fixture routes:

- B1-B3: `http://localhost:3000/handover/00000000-0000-4000-8000-000000009922`
  (`HO-B1-B3-KIT`, main item + Charger, Cable, Battery, Case, Tripod).
- B4: `http://localhost:3000/handover/00000000-0000-4000-8000-000000009923`
  (`HO-B4-SCOPE`, non-kit main item only).

The signed-in account is the existing Supabase Auth account whose UUID/email
were passed to `handover-manual.ps1 -Action Setup`; the local fixture gives that
profile the `lab_assistant` role in lab 7301. The borrower is the synthetic
same-lab active Student `Demo Student`; the student does not sign in.

After JS completed B3 and B4 in the browser, the read-only
`verify_handover_browser_b1_b4.sql` script checked the persisted rows. The
browser observations and the database verification are recorded separately
above; neither was used as a substitute for the other.

**Observed limitation (pre-existing, minor):** each loan's `due_date` equals
the reservation's `end_at` truncated to the millisecond (here 257 µs earlier),
because Loans passes `end_at` through a JavaScript date. Fixture times come from
`now()` (microseconds); reservations ending on whole seconds or minutes are
identical. Not changed in this PR.

**Earlier runs (superseded; before the ID check and fulfilment):** TC-3.1 on
2026-11-18 (1 loan, 6 pickup rows), and TC-3.4/3.5/3.7 before the review fixes.

Shared Supabase was not used; no shared migration was applied.

## Open questions

- **Resolved (JS + PO ZZ, 2026-11-19):** reservation writes in Loans (LJ),
  fulfilment in one transaction, fulfilled not cancellable/reschedulable,
  cancellation blocked while a handover is unfinished or uncertain, eligibility
  `start_at <= now < end_at`, automatic single selection with multiple eligible
  reservations blocking, immutable confirmed dates. Earlier: identity, recovery
  scope, uncertain-outcome UI (table at the top).
- **Confirmed technical requirements for LJ:** implement C1-C6 and the minimal
  status grant in S2-01; S2-09 does not duplicate that work.
- **Out of scope:** C7 and any change to how S2-02 treats `fulfilled`
  reservations, including early-return behaviour.
- **Dependency (LJ, S2-01 migration):** `GRANT UPDATE (status) ON
  public.reservations TO unitrack_loans_service`. Without it no handover can
  complete (503 `reservation_fulfillment_unavailable`, nothing changed).
- **Combined automated testing:** S2-02, S2-09 and S2-13 now pass together on a
  fresh disposable database with restricted service roles. Still pending,
  because LJ's S2-01 status grant and reservation-write
  endpoints do not exist yet: S2-09 with that real grant and code (cancel vs.
  handover in both commit orders, every state in the table, fulfilled
  terminal, immutable dates, the common item lock). Until then fulfilment and
  locking results cover only the synthetic stand-in and the reference sketch,
  and the dependency stays **open**.
- **Browser acceptance:** NH's 2026-11-19 run covered TC-3.1, 3.4, 3.5 and the
  TC-3.7 refusals before the note rule. JS's later 2026-11-19 run completed all
  required focused B1-B4 note-validation checks and the persisted-result
  verifier; all passed on an isolated database with the synthetic local grant.
  Optional B5 was not run. Reload/retry was not checked in the browser.
- **Equipment owner (component versioning):** the post-checkout component check
  narrows but cannot remove the window before the loan COMMIT (no distributed
  transaction). Equipment has no API that edits kit components today. If one is
  added, agree a version/lock contract.
- **SN (custody): resolved.** Migration 007 preserves Loans INSERT of handover
  loans and UPDATE of `reservations.handover_operation`; the combined suite also
  proves `status = 'fulfilled'` using only the clearly marked synthetic LJ grant.
