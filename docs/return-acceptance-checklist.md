# ZZ return acceptance — C430PRJCT-41 / S2-10 and C430PRJCT-42 / S2-11

Starting point: clean main at 90fda3f71cce4fdda441370c5a5fab0f1a6d8697.
Task branch: feature/C430PRJCT-41-42-return-acceptance. Changes remain uncommitted.
Authority: the user's supplied card text/screenshots and updated Sprint 2 work split.
Historical migration backlog is not an additional acceptance requirement.

## Requirement map

| Requirement | Existing code | Existing automated evidence | Focused acceptance evidence / manual verification |
| --- | --- | --- | --- |
| Assistant scans the returned item and opens its return | Web /scan currently displays an Equipment UUID. Existing /return/[loanId] page is assistant-only. | QR payload/scanner helpers and return API authorization are tested; scan-to-loan navigation is not implemented. | SC-owned integration gap: resolve item UUID to the same-lab open loan and navigate using its loan ID. Manual phone camera/navigation check remains. Do not implement SC's feature here. |
| See handover condition and kit components; check and confirm | return-details.tsx displays pickup conditions/notes; return-form.tsx generates a main-item row plus every pickup component; Loans validates the whole pickup checklist. | Return checklist/validation/inspection tests; real localhost Loans HTTP fixtures. | Interaction suite loads real ReturnDetails, inspect five component labels/pickup conditions, require each choice, and submit the real form through the Web gateway. Manual phone readability/control checks remain. |
| TC-4.1: all five components present and undamaged -> Available | Loans determineReturnOutcome and confirmReturn; Equipment status API and atomic history insertion. | Existing clean-return tests exercise one main-item condition and service rules, not five-component UI interaction. | New suite uses five distinct component IDs plus the main item; asserts all six persisted return conditions, returned_at, signed recorder, recorded timestamps, Available Equipment state/history and displayed outcome. |
| TC-4.1: history shows an on-time return | Loans stores due_date/returned_at, return condition timestamps and completed return_operation.result.isLate; Equipment stores status-change history. Completion UI displays Recorded as on time. | Service tests assert isLate and record persistence. | New suite compares persisted returned_at with due_date, checks all condition/history timestamps, completed isLate:false and completion display. The existing assistant page now has a read-only completed Return history section with persisted returned time, On-time/Late return and all recorded return conditions. Reload tests change today's Equipment status and still verify the recorded history. No separate is_late column or schema change was added. |
| Active new pickup period -> Reserved | hasActivePickup reads confirmed reservations through Loans, excludes the current reservation and future windows; Equipment status is set over HTTP. | Existing service rule/query tests cover active-versus-future windows. | New five-component interaction case asserts Reserved in persisted Equipment history and rendered outcome. Reservation-window matching is modeled, not SQL-executed. Manually verify with an authorized isolated active confirmed reservation, and compare a future-only reservation. |
| TC-4.2: missing charger -> Inspection Required, never Available | requiresInspection detects missing; same Saga/persistence path. | Existing missing-component HTTP and pure inspection tests. | New real-form case selects Missing for the charger; asserts that exact component's persisted condition and Inspection Required state/history/display, with no Available transition. |
| TC-4.2: student sees the problem | The existing student dashboard now has My return problems, read through the Web gateway and Loans, restricted by signed borrower identity/lab. Equipment provides item/component labels. Full assistant return details remain forbidden to students. | Existing catalogue/API privacy checks, plus new own-return endpoint and dashboard interaction tests. | Original catalogue visibility test is retained. New tests display Charger: Missing at return and specific new-damage notes on the dashboard, reject other borrowers/labs, hide open loans/unchanged existing damage and exclude internal return_operation data. Real signed-in/phone verification remains. |
| TC-4.3: sensor pickup Good, return broken casing -> Inspection Required | Pickup comparison, damaged/newDamage/notes handling, status API and return condition persistence. | Existing new-damage versus existing-damage service tests. | New real-form sensor case verifies pickup Good, chooses Damaged/new damage, enters broken-casing notes and checks the persisted record, history and displayed Inspection Required outcome. |
| Do not regress authorization, replay or crash recovery | Verified Web profile/JWT; Loans assistant/lab checks; persisted return_operation, session lock, stable keys, ownership-guarded compensation. | Existing role/lab/forged-identity, duplicate/concurrency, response-loss, uncertain COMMIT/ROLLBACK and interrupted compensation suites. | Retain all existing assertions. Interaction checks must also cover incomplete form, duplicate submission and blocked/uncertain response behavior. Models are not live PostgreSQL evidence. |

## Implemented read-only acceptance views

The assistant's existing /return/[loanId] page now shows completed return history:
returned time, On-time/Late return, recorded condition timestamps, conditions and
notes. The Loans GET /returns/:loanId response adds returnHistory for completed
loans, derived from persisted returned_at/due_date and phase=return records. No
historical outcome is inferred from today's Equipment status, and no operation
metadata is serialized. Missing legacy condition rows are reported as unavailable,
not fabricated. Existing open-return behavior and authorization are unchanged.

The student's existing /dashboard now mounts My return problems. Web GET
/api/returns/problems/mine forwards a freshly verified profile identity to Loans
GET /returns/problems/mine. Loans accepts students only and selects completed loans
by BOTH actor.sub and actor.lab_id; browser borrower/lab parameters are ignored.
It compares persisted pickup and return conditions: missing items are included;
new damage is Damaged compared with recorded Good pickup or an explicit additional-
damage marker persisted by the existing return writer. Unchanged existing damage
is omitted. Unknown/attention-only records are outside this missing/new-damage
section. The generated marker is removed from the displayed user notes.

The user explicitly approved the additional API permission before implementation:
Equipment GET /items/:id/component-labels accepts verified same-lab user identities,
including students, and projects only component IDs/names. The original staff-only
/components endpoint and all database grants remain unchanged. The Web gateway
resolves names only after Loans authorizes the own-return read, and projects only
loan/item IDs, return date, problem kind, label and notes. It performs no Users
borrower-name lookup and never returns return_operation, fingerprints, request keys
or borrower identity fields. Labels unavailable from Equipment produce an explicit
partial-data notice while retaining the recorded problem.

This adds no notification, email, inspection resolution, new borrowing workflow,
schema or database-permission change. Problem records are historical statements,
not a claim about current Equipment availability or unresolved repairs.

## SC integration contract (not implemented here)

1. The scan payload is an Equipment item UUID, NOT a loan ID.
2. Through an authenticated Web gateway, ask Loans to resolve the same-lab open
   loan for that item (returned_at is NULL), using the verified assistant identity.
   There is currently no such active-loan-by-item lookup endpoint. SC must agree
   its route/response contract with Loans rather than misuse the due-date API.
3. A successful match supplies loanId and navigates to /return/[loanId]. Reject
   wrong-role/cross-lab access; show a clear no-open-loan state. Do not expose
   borrower information to students or use browser role/lab claims.
4. No SQL in Web or Equipment for this lookup. Reuse the existing return page,
   GET/POST /api/returns/[loanId] and Loans GET/POST /returns/[loanId].

## Isolation and teammate contracts

- Migration 006 permits Loans SELECT/UPDATE on loans, SELECT on reservations and
  SELECT/INSERT on condition_records. This fits the current return path and
  return_operation updates. Role/lab restrictions still belong in the handlers.
- Loans must retain a direct/session-pooled connection and explicit
  LOANS_DATABASE_SESSION_AFFINITY acknowledgement. Do not replace durable operation
  metadata with client state or generate fresh apply keys for a retry.
- NH supplies a valid open loan and pickup records. Agree the main-item/non-kit
  pickup shape; the current return rejects an entirely empty pickup record.
- SN's future custody UPDATE protection must allow the required return_operation
  transitions and the one-time returned_at write. An unconditional ban on all
  other loan updates would break recovery. Do not change NH/SN code or migrations.
- No migration or grant change is needed for this acceptance-test task. Latest
  handoff records disposable PostgreSQL evidence and says shared activation of
  006 remains pending; this task does not query or change live readiness.

## Manual acceptance (not run in this task)

Use an explicitly authorized isolated environment with synthetic pre-existing
fixtures supplied through the agreed NH/test setup. Do not change shared Supabase,
run SQL/migrations, edit seed.sql or expose tokens/configuration for this task.

1. Sign in as a same-lab assistant on a real phone. Once SC's integration is
   available, scan and confirm it selects the correct open loan; until then use
   the known fixture loan ID directly and record the scan step as pending.
2. TC-4.1: inspect Good pickup conditions, check all five components and main item,
   confirm; inspect the return response/authorized record evidence and Equipment
   state/history. Verify returned_at <= due_date and all conditions are recorded.
3. Repeat with a different open loan and an active new pickup window: Reserved.
   A future-only reservation must not trigger Reserved. Avoid replaying an already
   completed clean loan with changed input; that must remain a conflict.
4. TC-4.2: separate kit fixture, charger Missing; confirm Inspection Required and
   the charger condition. Sign in separately as the same-lab student and inspect
   catalogue status. Refresh the student dashboard after confirmation and verify Charger: Missing at return for that student's completed return; another student/lab must not see it.
5. TC-4.3: separate sensor fixture, pickup Good, broken casing at return; confirm
   Inspection Required and persisted notes/new-damage marker. No Available history.
   Reload the assistant return page to inspect recorded conditions and the timing
   outcome; check that later Equipment status changes do not rewrite that history.
   On the student dashboard verify the specific new-damage explanation/notes.
6. Verify other roles/cross-lab requests fail, a repeated identical confirmation
   adds no records/history, and a lost/uncertain response does not invite blind undo.
7. JS signs off S2-10/S2-11; ZZ does not self-accept these cards. Record phone and
   authenticated workflow evidence against the exact TC numbers.

## Earlier test-only verification (historical)

- Added apps/web/tests/return-acceptance.test.tsx: **8 passing interaction tests**,
  supported by tests/fixtures/return-acceptance-http.ts. Existing business/recovery
  assertions and production code are unchanged.
- Kept Vitest and React DOM; added jsdom 26.1.0 as a development-only DOM environment
  for this test file. No other test file's environment/configuration changed. Node
  native crypto, byte arrays and abort signals allow real JWT/HTTP checks inside
  the DOM environment; token signing/verification and React state are not mocked.
- Full root checks passed: npm run typegen; npm test (**485 passed, 3 skipped**);
  npm run lint (no warnings); npm run typecheck; npm run build (packages/all apps).
  Web increased from 133 to 141 passing tests; other workspace counts are unchanged.
- The opt-in UNITRACK_TEST_DATABASE_URL was empty for the verification process, so
  the 3 SQL integration tests stayed skipped. No SQL, migration or shared-data
  operation ran. New tests use real React/native DOM interactions, Web gateway
  handlers, signed local HTTP and actual service handlers with in-memory database
  and verified-profile fixtures. They are not live PostgreSQL or real signed-in
  Supabase/phone evidence. Equipment history is the modeled production INSERT
  parameters/default timestamp; return history is the modeled recorded conditions,
  timestamps and completed operation result, not a mocked success message.
- No existing installed package version changed. npm audit reported 10 findings
  (8 moderate, 2 critical), all involving pre-existing packages; no newly added DOM
  dependency was flagged. No unrelated audit fix/upgrade was attempted.
- Git whitespace checks passed. Changes are uncommitted/unstaged on the task
  branch; HEAD remains 90fda3f. Private files were not read, copied or changed.

The original verification record above describes the preceding test-only step.
This continuation implements the two read-only views; its final results follow.

## Read-only views continuation verification (before focused review)

Final root verification passed: npm run typegen, npm test (**500 passed, 3 SQL
integration tests skipped**), npm run lint (no warnings), npm run typecheck and
npm run build (packages and all four applications). Web has 156 passing tests;
shared auth 63, Equipment 153, Loans 78 and Users 50 remain passing.

Added 13 read-view/privacy interaction cases and 2 wire-contract cases. They cover
completed on-time/late history, all recorded return conditions, current Equipment
status changes, specific Charger/new-damage display, unchanged existing versus
additional damage, borrower and lab isolation, forged browser query/header values,
open-loan exclusion, actual-handler token/role rejection, minimal labels and label
service partial failure. The prior 8 acceptance tests and all business/recovery
assertions remain intact. Shared fixture reads model persisted records; no SQL or
migration is run by these tests. Real Supabase session bootstrap is mocked.

No schema or database-grant change was necessary: 006 already permits the required
owned-table SELECT operations. Only the explicitly approved minimal Equipment API
label permission was added; the original staff component endpoint is unchanged.
The return writer only shares its existing damage-note constant with the reader;
its storage format, transactions and return_operation recovery are unchanged.
No new dependency was added beyond the earlier test-only jsdom addition. Git
whitespace checks passed. All changes remain uncommitted/unstaged on the existing
feature branch, preserving the earlier uncommitted acceptance work.

Remaining manual evidence: real signed-in Supabase browser/phone workflows,
restricted runtime role/RLS readiness and label endpoint behavior on the aligned
services; SC scan-to-return navigation; NH pickup fixture agreement; SN custody
protection preserving return_operation; and JS sign-off. No teammate feature or
shared database/deployment configuration was changed.

## Focused review

Reviewed all uncommitted changes, including the original eight acceptance tests.
Confirmed verified borrower/lab/completed filters in both Loans reads, explicit
student projections with no internal return_operation/profile fields, same-lab
minimal Equipment labels, unchanged staff component permissions and retained
return persistence/retry/compensation behavior. No migration or permission change
was added by this review. Migration 006 provides the existing SELECT operations;
its RLS is service-level and does not replace these user/lab filters.

Fixed the following within this scope:

- The assistant gateway formerly spread a valid upstream object, which could
  retain unexpected root/nested operation or other-borrower fields. It now
  projects only approved details/history/condition fields and the four outcome
  fields. Injected-extra-field tests cover GET, POST/replay and student responses.
- Invalid optional Equipment/Users label configuration formerly hid assistant
  history. It now gives the same safe partial fallback as unavailable HTTP
  services, retaining persisted timing/conditions. Invalid/offline Equipment
  tests cover both assistant history and the student problem panel.
- Read-only new-damage classification now requires either a recorded Good pickup
  baseline or the existing explicit additional-damage marker. Missing/unknown
  pickup data is not proof of new damage. Missing components still appear, and
  conservative inspection decisions in the existing return writer are unchanged.
  Incomplete legacy pickup data requires manual review; it is not silently fixed.
- History wire validation rejects timing labels contradicting persisted dates.
  History reload is tested after exact replay and subsequent Equipment changes.
- The student panel is keyed by the server-verified profile/lab to discard local
  panel state on a profile change. Real account-switch behavior remains a manual
  signed-in check. The key is not used as authorization or sent as a borrower ID.

Added nine regression cases: four view/auth/fallback cases, four pure historical
comparison cases and one wire consistency case. Original assertions are preserved.
Final focused-review root checks all passed: typegen; npm test (**509 passed,
3 SQL integration tests skipped**); lint without warnings; typecheck; and builds
for shared packages and all four applications. Counts: Web 161, auth 63, Equipment
153, Loans 82 and Users 50. The original eight acceptance tests are unchanged.
All prior work and these fixes remain unstaged/uncommitted at HEAD 90fda3f.

Changed-file credential-pattern review found no credentials outside explicitly
public dummy fixtures; private environment files were excluded and never opened.
No existing package version changed, and no unrelated dependency upgrade, migration,
scan navigation, handover, custody trigger or deployment change is present.

Remaining acceptance: real Supabase assistant/student phone workflows; two-student
and cross-lab isolation/account switching; exact history after reload/replay; label
outage fallback; and separately authorized restricted-role/RLS/pooler verification.
SC navigation, NH pickup fixtures, SN custody/recovery compatibility and JS sign-off
remain coordinated manual/integration work. Mock/localhost tests and skipped SQL
tests do not prove production database grants, live SQL behavior or phone usability.
