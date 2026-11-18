# Handover — S2-09 / C430PRJCT-40 (NH)

Kit checklist, condition and student confirmation. A lab assistant opens
`/handover/[reservationId]`, ticks every row, records a condition (with optional
notes), checks the student's university ID card in person and ticks the ID check,
and the student ticks the confirmation box on the same screen. The handover is
complete only after both ticks, a Users check that the borrower is an active
student of the lab, and a successful Equipment checkout.

## Final Product Owner requirements (confirmed by JS) — RESOLVED

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Borrower must be an **active, same-lab Student** matching the confirmed reservation | Users `GET /profiles/:id/borrower` reports `id, full_name, role, lab_id, is_active` (staff-only, same lab, other labs 404). Loans applies one shared rule, `isEligibleBorrower` (contracts): id = the reservation's `borrower_id`, `lab_id` = the reservation's lab, `role = 'student'`, `is_active`. Checked before checkout and again after checkout before saving; the final transaction also re-reads the reservation (same borrower, item, lab and dates). Fails closed: not found / not a student / other lab / inactive / other id → 409 `borrower_unverified`; Users unreachable or malformed → 503 `borrower_unavailable` before checkout or `handover_incomplete` after it. The page shows the checklist only when the same rule passes. | Loans adapter tests (student, lab assistant, professor, lab manager, other lab, inactive, wrong id, missing lab, 404, 5xx, network); service tests (authoritative id+lab, ineligible before and after checkout); gateway tests (non-student, other lab); real PostgreSQL via the restricted Users role (lab assistant, other-lab student, inactive student). |
| Assistant physically verifies the student's **university ID**; no student login or ID upload | Separate **University ID check (lab assistant)** checkbox, independent of the student's confirmation. Loans requires `universityIdVerified: true` (400 `id_verification_required` before any database, Users or Equipment access) **and** `studentConfirmed: true`. Evidence stored with minimal schema: `loans.university_id_verified_at` + `loans.university_id_verified_by` (the assistant). No ID number, upload, photo or student sign-in; unknown body fields are ignored and never stored. | Service, route, gateway and UI tests (ID tick missing, ID tick without confirmation, confirmation without ID tick, extra ID-number/photo fields not stored, no text/file inputs); migration static + `verify_C430PRJCT-40.sql` + PostgreSQL RLS tests. |
| Durable, retryable recovery is sufficient; no worker; no cross-assistant expansion | Unchanged request-driven Saga and existing recovery (kept, not removed). The durable plan now also stores the ID-check evidence (`idVerifiedBy` + `universityIdVerifiedAt`) and the confirmed dates, so recovery reuses the ORIGINAL verification and checklist and never asks again. No background worker added; who may recover is unchanged. | Recovery by the starter and (for `applied`) another assistant keeps `university_id_verified_by` = original assistant (service + PostgreSQL); corrupted/missing evidence in a stored plan → `handover_state_uncertain`. |
| UI clearly shows uncertain outcomes and prevents fresh submissions while unresolved | Outcomes are classified: **completed** (200), **failed** (4xx, `borrower_unavailable`, `handover_rolled_back`: nothing handed over, form stays editable) and **uncertain** (other 5xx such as `handover_state_uncertain`/`handover_incomplete`, network errors, unverifiable responses). After any unsuccessful attempt the page re-reads Loans: an unresolved operation replaces the form with **Handover not finished — outcome uncertain**, keeps the error visible, states that a new handover cannot start, and offers only **Finish interrupted handover** (the same operation). If no operation was saved (e.g. lost connection), the form is locked under **Outcome not confirmed** and only **Retry the same handover** (identical information, same key) is possible. Loans independently refuses a different submission while an operation is unfinished. | UI tests (uncertain with saved plan → only recovery, saved checklist used; lost connection → locked form, only identical retry; definite failure → no uncertain notice); service test (fresh submission and other assistant refused while `planned`; same information resumes the same key). |
| Confirmed reservation dates cannot be edited | Handover never writes reservation dates (Loans has no grant to). The plan stores the confirmed `start_at`/`end_at`; the final loan transaction refuses with 409 "The reservation changed during handover" (guarded undo, no loan) if they differ, so the saved due date is always the confirmed `end_at`. LJ confirmed (2026-11-19) that rescheduling = cancel + new reservation and that handed-over reservations cannot be rescheduled — a **stated requirement, not yet enforced** in any code or database (see "Reservation rules"). | Service tests (start or end edited after checkout → undo, no loan; retry plans from the current reservation); real PostgreSQL (end date edited by another connection after checkout). |

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
| SC eligibility: reservation and equipment in the assistant's lab; `confirmed`; `start_at <= server now < end_at`; no active loan for the item; it is the ONLY confirmed reservation for the item whose window contains now | Loans, on locked rows: when the plan is made, before a new attempt after an undo, and again in the final loan transaction at the server's current time. A per-item transaction lock (`loans:handover:item:<id>`) serializes handovers of different reservations for one item. Failing at final submission undoes the checkout (ownership-guarded) and returns the failed rule as 409. |
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
`student_confirmed_at` = accepted time) and one `phase = 'pickup'` condition
record per row — for the five-component TC-3.1 kit that is **six** records (main
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
   its existing direct/session-pooled connection requirement).
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
   rules on locked rows, inserts the loan and all pickup records and marks the
   plan completed. Double clicks / retries with identical input replay the
   stored result; different input or a different assistant gets 409.
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
  not work under 006 without this. Loans still cannot insert `returned_at` or
  `return_operation`, update reservation status, or update/delete condition
  records.
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

**Full `run.ps1` passed on 2026-11-18 after the JS changes** (fresh container): preflight gates PASS; 003, 004, 005, 006 and this migration (applied twice) verified; static migration compatibility 5/5; existing Equipment/Loans (Return) PostgreSQL suite 3/3; handover PostgreSQL suite 21/21 as restricted roles.

Shared Supabase was not touched. Verified on disposable PostgreSQL via
`database/local-test/run.ps1` (applies it twice, runs
`verify_C430PRJCT-40.sql` and `services/loans/tests/postgres-handover.integration.test.ts`
as the restricted service roles).

## Reservation rules, `main`, S2-02, and remaining cross-service races

Inspected 2026-11-19 (read-only; nothing merged, no teammate file changed):
`origin/main` at `bf0fd3c` (PR #25, SC scan/pickup match — not yet merged into
this branch; a dry-run merge is clean) and LJ's
`origin/feature/S2-02-no-double-booking` at `d90cf11` (awaiting review; its
migration is **not** applied to shared Supabase).

### Stated by LJ vs actually enforced

| LJ statement (2026-11-19) | Enforced where today |
| --- | --- |
| 1. Confirming a reservation does not change the equipment's physical status; Available equipment can be handed over if eligible | Consistent with PO decision A2 and with this card (accepts `available` or `reserved`). No reservation writer exists, so nothing could change it anyway. SC's pickup gateway on `main` also allows only `available`/`reserved`. |
| 2. No overlapping confirmed reservations (PostgreSQL exclusion constraint); consecutive allowed | **Only on LJ's unmerged branch**: `reservations_no_overlapping_confirmed EXCLUDE USING gist (item_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status = 'confirmed')` + `btree_gist`. Not on `main`, not on shared Supabase. Covers only rows whose status is `confirmed`. |
| 3. Confirmed dates must not be edited; reschedule = cancel + new; handed-over reservations cannot be rescheduled (the proposal below also covers item, borrower and lab) | **Not enforced anywhere** (no trigger, no API — no reservation create/confirm/cancel/edit route exists on `main` or on LJ's branch). LJ: a business rule for now, to be enforced in S2-01 (not started). This card only detects a change *during* its own handover (final re-check → undo). |
| 4. S2-02 does not implement locking coordinated with handover | Confirmed: LJ's branch adds no lock, trigger or check that references loans or `handover_operation`. |
| 5. LJ's code awaits review; migration not applied to shared Supabase | Confirmed from the branch (migration header: "never run against the shared database without approval"). |

What this card enforces (unchanged): per-reservation session lock; per-item
transaction lock `loans:handover:item:<item_id>`; SC eligibility on locked rows at
plan time and in the final loan transaction at server time; Equipment
`expectedStatus` + operation ownership under its row lock;
`loans_one_active_per_item` and unique `loans.reservation_id`; the reservation's
borrower, item, lab and confirmed dates re-read (`FOR UPDATE`) in the final
transaction. Handover never changes reservation status: a handed-over reservation
stays `confirmed` with a loan.

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

### What the exclusion constraint does and does not cover

With S2-02 applied and the current half-open rule, two `confirmed` reservations
for one item can never both contain `now`, from any writer, including writers
concurrent with a handover (the constraint check waits for the other
transaction). That closes the old race "another reservation becomes eligible
between the final eligibility count and COMMIT", and makes the earlier ask that
reservation writers take `loans:handover:item:<id>` unnecessary **for creating or
confirming**. Handover still keeps its own locks and the multiple-eligible check
(defence in depth; see the unresolved boundary question below).

It does **not** coordinate the reservation being handed over, because the
constraint only constrains rows while `status = 'confirmed'`:

### Remaining gap — cancel/re-date of a reservation with a handover

No writer is prevented from cancelling, un-confirming or re-dating a reservation
that is mid-handover or already handed over:

- **During a handover** (plan `planned`/`applied`): the final transaction sees
  the change and undoes the checkout (safe, tested), but a student standing at
  the counter loses the handover, and an `applied` plan whose starter is absent
  stays for staff.
- **After a handover** (loan exists, item `checked_out`): the reservation can be
  set to `cancelled`/`pending` or re-dated. It then leaves the exclusion
  constraint, so a **new overlapping confirmed reservation** can be created for
  an item that is physically out on loan; and the reservation's dates no longer
  match the loan's `due_date`. This violates LJ's rule 3 and is not detected by
  anything.

### Proposed coordination (PROPOSAL — untested, not implemented, awaiting JS/LJ agreement)

LJ confirmed (2026-11-19): **S2-01 has not started; LJ owns reservation-side
protection; confirmed-date immutability is currently a business rule only, to
be enforced in S2-01.** Nothing below exists in code or in any migration.

How the two mechanisms would split the work:

| Mechanism | Protects | Owner |
| --- | --- | --- |
| S2-02 exclusion constraint | Two `confirmed` reservations for one item never overlap, from any writer or role, including writers concurrent with a handover (constraints ignore grants/RLS). | LJ (exists, unmerged) |
| Reservation-row lock (`SELECT … FOR UPDATE` on the reservation, then check, then `UPDATE`, in one transaction) | Every S2-01 status change re-checks `loans.reservation_id` and `handover_operation ->> 'state'` while holding the same row lock that handover's final transaction holds while it inserts the loan. Either the status change commits first (handover re-check refuses and undoes — existing, tested) or the loan commits first (the status change sees it and applies the agreed rule). | LJ (S2-01) |
| Immutable confirmed details | A `confirmed` reservation's `item_id`, `start_at`, `end_at`, `borrower_id` and `lab_id` never change (rescheduling = cancel + new). Database backstop: a `BEFORE UPDATE` trigger comparing only those five columns — it needs no access to `loans`. | LJ (S2-01) |
| Handover | Unchanged: its own locks, re-checks on the locked row, guarded undo. | NH |

Illustrative backstop for the immutable fields only (untested sketch; no status
rule, because the permitted transitions are not agreed):

```sql
-- PROPOSAL ONLY. Untested. Awaiting JS/LJ agreement. Owner: LJ (S2-01).
CREATE OR REPLACE FUNCTION public.reservations_confirmed_details_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$   -- SECURITY INVOKER (default)
BEGIN
  IF OLD.status = 'confirmed'
     AND (NEW.item_id, NEW.start_at, NEW.end_at, NEW.borrower_id, NEW.lab_id)
         IS DISTINCT FROM (OLD.item_id, OLD.start_at, OLD.end_at, OLD.borrower_id, OLD.lab_id) THEN
    RAISE EXCEPTION 'A confirmed reservation''s item, dates, borrower and lab cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
```

**Status changes after a handover are NOT banned wholesale.** Which
transitions must stay permitted is a JS decision (see questions below). Once
agreed, LJ enforces them in the S2-01 transaction under the row lock, and
optionally as a trigger rule.

**Service isolation under 006.** 006 gives `loans` and `reservations` access
only to `unitrack_loans_service` (SELECT on reservations; SELECT/UPDATE on
loans), with RLS on and exactly 18 `unitrack_*_service_*` policies checked by
`postflight_006_read_only.sql`. Assumptions and consequences:

- **Assumption:** S2-01 reservation writes run in the Loans service as
  `unitrack_loans_service` (the pickup lookup already lives there). Then the
  `loans` check uses Loans' existing SELECT grant and
  `unitrack_loans_service_loans_select` policy — no new access to `loans` for any
  role. Any trigger stays `SECURITY INVOKER`. It must not be `SECURITY DEFINER`:
  run as the table owner, it would read `loans` outside RLS and the service
  grants.
- S2-01 needs its own additive, column-level grants on `reservations` (e.g.
  `INSERT`, `UPDATE (status)`), in the style of this card's migration. Every
  new RLS policy must be **explicitly verified** by S2-01's own verification
  script (exact name, table, command, role, and its USING / WITH CHECK
  expressions), with restricted-role tests showing what it allows and refuses.
  It must also re-assert that 006's reviewed grant/policy matrix is unchanged.
  Policy naming is not a substitute for that verification. `SELECT … FOR
  UPDATE` needs UPDATE on at least one column; Loans
  already has `UPDATE (handover_operation)` from this card's migration and will
  have S2-01's grant.
- If JS/LJ instead put reservation writes under **another role**, that role must
  not get SELECT on `loans`. Options to agree first: route status changes
  through Loans, or a narrow reviewed function (EXECUTE granted only to that
  role) that returns only "has a loan / handover in progress" for one
  reservation.

**Questions for JS** (the proposal is blocked on these):

1. Which reservation status transitions must remain permitted **while a handover
   is in progress** (`planned`/`applied`/`compensating`) and **after a handover
   completed** (loan exists, item out)? For example: `confirmed → cancelled` as
   an admin correction, `confirmed → fulfilled` at handover or at return,
   `confirmed → expired` after `end_at`.
2. If a handed-over reservation may leave `confirmed`, should the exclusion
   constraint also cover that status (e.g. `WHERE status IN ('confirmed',
   'fulfilled')`) so that a new booking cannot overlap equipment that is out on
   loan?
3. Confirm the assumption that S2-01 reservation writes run in the Loans service.

**NH (this card)** — **provisionally** no handover service change is expected.
This is an analysis, not a tested result: it holds only until S2-02 and the
S2-01 protection are tested together with handover on a disposable database
(concurrent handover vs. status change, both commit orders). If that combined
testing shows a gap, the handover service may need changes. After S2-02 merges:
resolve the one-line `database/local-test/run.ps1` conflict (both add steps after
006; order is independent), and adapt this card's PostgreSQL fixtures that
insert overlapping confirmed reservations (the two-eligible-reservations test
and the `finalOverlap` case insert a second overlapping `confirmed` row, which
the constraint will reject with 23P01). Replace them with an assertion that the
database rejects the overlap during a handover; keep the multiple-eligible rule
covered by the service unit tests. Once JS has agreed the permitted transitions
and S2-01 enforces them, add PostgreSQL tests for those transitions during and
after a handover. Re-check the `finalCancel` case and the overlap-resolution step
(which cancel a reservation) against that rule.

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

### Browser acceptance results (disposable database only)

| Case | Result | Evidence (read-only queries on the local container) |
|---|---|---|
| TC-3.1 (re-run 2026-11-18, after the review fixes and A1/A2) | Pass | Reservation `…9921`: exactly **1** loan (borrower `…9902`, due date set, `student_confirmed_at` set, not returned); **6** `pickup` records = **1** main-item record (`kit_component_id` NULL) + **5** distinct records for the kit's 5 active components (Charger, Cable, Battery, Case, Tripod), all `good`, same lab, recorder set; item `checked_out`; plan state `completed`; 1 active loan on the item. |
| TC-3.1 … TC-3.7 with the university-ID checkbox | **Pending (NH, in progress)** — on a fresh `handover-manual.ps1 -Action Setup` (the earlier manual database predated the ID columns) | Automated coverage above; full `run.ps1` passes with the ID check (2026-11-18). |
| TC-3.4, TC-3.5, TC-3.7 | Pass (before the review fixes) | Missing charger saved as `missing` with its note; existing damage saved as `damaged` with its note and no photo; without confirmation the reservation stayed reserved and no loan was saved. Since then covered by the automated A1 and confirmation tests above; not re-run in the browser. |

Shared Supabase was not used; no shared migration was applied.

## Open questions

- **Resolved by JS (final PO requirements):** the identity interpretation
  (active same-lab student + physical ID check, no student login or upload),
  recovery scope, uncertain-outcome UI and confirmed dates — see the table at
  the top. The cross-service races above are **not** removed by these decisions.
- **Equipment owner (component versioning):** the post-checkout component check
  narrows but cannot remove the window before the loan COMMIT (no distributed
  transaction). Equipment has no API that edits kit components today. If one is
  added, agree a version/lock contract (e.g. a component-list version or refusing
  edits while an item is reserved/checked out).
- **UNRESOLVED (JS to confirm) — pickup window end.** Earlier agreement:
  `start_at <= now < end_at`. LJ's latest message: `now <= end_at`. **Kept:**
  `now < end_at` (also used by SC's pickup lookup on `main`, Return, and matching
  S2-02's half-open `[)` ranges). Note: with an inclusive end, two consecutive
  reservations (allowed by S2-02) would both be eligible at the exact boundary
  instant, which interacts with the next question.
- **UNRESOLVED (JS to confirm) — multiple eligible reservations.** Earlier
  agreement: they block handover. LJ's latest message: manual selection.
  **Kept:** blocking (409 "More than one reservation is eligible…", same as SC's
  `multipleEligibleReservations`). With S2-02 and the half-open window this case
  cannot arise from `confirmed` rows; it can only arise if the inclusive end is
  adopted.
- **Answered by LJ (2026-11-19):** confirming a reservation does not move the
  equipment to `reserved` (handover sees `available`, allowed by A2); handover
  does not mark the reservation `fulfilled` (keep it `confirmed`, see the
  exclusion-constraint note above).
- **LJ (S2-01/S2-02, via JS) — still needed** (not implemented here; teammate
  code not changed):
  1. ~~Prevent overlapping confirmed reservations~~ — done on
     `feature/S2-02-no-double-booking` (exclusion constraint), pending review and
     a controlled shared application. The database owner should first run a
     read-only check for existing overlapping `confirmed` rows, or the
     `ADD CONSTRAINT` will fail.
  2. ~~Per-item lock on create/confirm~~ — no longer needed for overlap once the
     constraint is applied (see above).
  3. **Open (LJ owns, in S2-01, which has not started):** reservation-side
     protection as proposed above — row-locked status changes that check
     `loans`/`handover_operation`, and immutable confirmed item/dates/borrower/lab.
     This waits for JS's answer on permitted transitions. S2-02 implements no
     handover coordination.
- **SN (custody):** future loan-update protection must still allow Loans to INSERT
  handover loans and UPDATE `reservations.handover_operation`.
