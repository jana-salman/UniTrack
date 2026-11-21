# S2-01 / S2-05 browser acceptance and S2-09 compatibility

Prepared for SC's local browser acceptance of PR #28. The compatibility
comparison uses the agreed C1-C6 contract from NH's
`origin/feature/s2-09-handover-nh-v2` at `c64e003`, specifically
`docs/handover-s2-09.md` under “Coordination contract for LJ (S2-01)”. C7 is
explicitly out of scope. No cancellation or expiry writer is implemented.

## C1-C6 compatibility matrix

| Contract | S2-01 / S2-05 implementation | Evidence | Limitations / handoff |
|---|---|---|---|
| **C1: shared transaction item lock; ascending order for multiple items** | Reservation creation locks the requested item and each tracked component using `pg_advisory_xact_lock(hashtextextended('loans:item:' || lowercase_uuid, 0))`, in ascending UUID order. It reads kit membership before the transaction to determine the set, acquires the full ordered set, then rereads membership and returns 409 if it changed. It rechecks item eligibility through Equipment after acquiring the lock. Equipment component mutation uses the same parent kit key. | `services/loans/lib/reservations/create.ts`; unit test verifies component-before-parent order and membership-change refusal; PostgreSQL reservation suite uses a component UUID that sorts before its kit and exercises kit/component reservations and concurrent overlap attempts; NH's S2-09 `lockReservation()` uses the same key before row lock. | Equipment data is read over HTTP, so it is not a cross-service database transaction; eligibility is rechecked under the shared lock. Browser acceptance still needs SC's app/auth environment. No cancellation/expiry writer exists. |
| **C2: row lock after item lock; verify item did not change** | S2-01 creation is an insert and has no pre-existing reservation row to lock. NH's handover writer follows the item-lock then `SELECT … FOR UPDATE` order and verifies the locked row's item id. Future status writers are documented to follow the same contract. | `services/loans/README.md`; NH `services/loans/lib/handover/service.ts` on the teammate branch; NH restricted-role PostgreSQL handover/lock tests in PR #24's reported run. | C2 is not exercised by an LJ status update because cancellation/expiry is deferred. SC/NH should rerun the combined branch test after PR #28 is updated. |
| **C3: confirmed reservation invalidation only after no unfinished handover and no loan row** | A database `SECURITY DEFINER` trigger blocks status changes while the operation is not `compensated`, and blocks confirmed→cancelled/expired/pending when any loan row references the reservation. It does not add table grants or alter RLS. | `database/migrations/S2-01_reservation_status_protection.sql`; restricted Loans-role PostgreSQL tests reject `planned`, `applied`, `compensating`, and compensated-with-loan invalidation; a compensated operation without a loan can transition to cancelled. | Cancellation/expiry endpoint and UI are intentionally deferred to Sprint 3. Pending-reservation cancellation is also not implemented. |
| **C4: fulfilled is terminal; only handover final transaction may fulfill** | Database trigger rejects all later status transitions from fulfilled and validates confirmed→fulfilled against S2-09's applied→completed operation, matching loan, ID evidence, and pickup record. | Status guard migration; restricted-role PostgreSQL tests cover normal completion, recovery completion, fulfilled terminality, and concurrency with a competing status writer. NH's finalization writes loan, pickup records, operation completion, and fulfilled status in one transaction. | No production cancellation/expiry path is present. Recovery/compensation integration depends on NH's S2-09 implementation remaining unchanged. |
| **C5: confirmed item, borrower, lab and date fields immutable** | Loans has only the narrow reservation INSERT columns and status/handover column update grants. It has no UPDATE grants for the confirmed identity/date fields. | `database/migrations/S2-01_reservation_permissions.sql`, `database/local-test/verify_S2-01.sql`; restricted-role test attempts updates to each of the five fields and expects PostgreSQL permission denial. | No rescheduling feature is implemented. |
| **C6: LJ never writes `handover_operation`** | S2-01 insert lists only `item_id, borrower_id, lab_id, start_at, end_at, status`; status guard reads but does not rewrite the operation. S2-09 owns operation updates. | `services/loans/lib/reservations/create.ts`; S2-01 verifier checks reservation column grants; NH migration and service own operation persistence. | NH's application branch/PR remains a dependency until its merge/integration with PR #28. |

The S2-09 teammate migration is inspected from the remote branch, not copied or
modified here. Its C1/C2 implementation acquires the common item transaction
lock before locking the reservation row, verifies `item_id`, and uses the same
lock in finalization/recovery paths. Its private `loans:handover:<id>` lock is
left to NH's service; reservation creation does not take it. S2-09's synthetic
grant in NH's historical manual harness is not a substitute for S2-01's actual
migration and restricted-role tests.

## Browser fixture setup (local disposable database only)

The fixture seed is one-shot and uses only synthetic records in lab 7001 and
category 7101 from the test harness. It does not connect to Supabase. From the
repository root in PowerShell:

```powershell
& .\database\local-test\run.ps1 -KeepDatabase
docker compose --project-name unitrack-sprint2-verification --file .\database\local-test\compose.yaml exec -T postgres psql -X --set ON_ERROR_STOP=1 --username unitrack_local_test --dbname unitrack_test --file /workspace/database/local-test/seed_S2-01_browser_acceptance.sql
```

This setup uses the isolated test project on port 55433. The existing SC
browser database on project `unitrack-migration-test` and port 55432 is separate
and must not be used for reseeding or teardown. It was left unchanged, so its
installed S2-05 trigger predates the reservation-resource snapshot correction;
use the fresh isolated project above for acceptance of that behavior.

Point locally configured Web, Loans and Equipment services at this disposable
database and authenticate as a local student whose identity is
`00000000-0000-4000-8000-000000000002` (lab 7001). Use the existing local
assistant/test identity for direct handover checks. Do not paste or commit
private runtime credentials. The seed is intentionally not loaded by automated
tests. It is one-shot: start from a fresh run of the local test harness.
`run.ps1 -KeepDatabase` keeps the same tmpfs-backed container alive on success;
tear it down when finished:

```powershell
docker compose --project-name unitrack-sprint2-verification --file .\database\local-test\compose.yaml down --volumes --remove-orphans
```

All reservation times are generated relative to database `now()` and rounded
to a minute. Equipment QR/asset identifiers use the `LOCAL-BROWSER-*` prefix.
Seeded reservations belong to the synthetic borrower and lab 7001; each has
status `confirmed`. The “current” item is physically `reserved` for handover;
other seeded eligible equipment stays physically `available`.

| Scenario | Seed records and reservation | Browser action / expected UI | API and database expectation |
|---|---|---|---|
| Upcoming reservation | Item `LOCAL-BROWSER-UPCOMING` / `…0101`; reservation `…0101`, now +3d to +4d, confirmed; borrower `…0002`, lab 7001. | Reservation list/detail shows the upcoming booking; it is not yet handover eligible. | Read returns confirmed reservation. Item remains `available`; handover lookup must not select before start. |
| Currently eligible reservation | Item `LOCAL-BROWSER-CURRENT` / `…0102`; reservation `…0102`, now −1h to now +2h, confirmed; borrower `…0002`, lab 7001. | Handover lookup may select it now (start ≤ now < end); handover detail can be opened by its reservation UUID. | Pickup lookup returns the confirmed same-lab reservation while active; reservation stays confirmed until NH's successful final transaction. |
| Expired reservation | Item `LOCAL-BROWSER-EXPIRED` / `…0103`; reservation `…0103`, now −3d to −2d, confirmed; borrower `…0002`, lab 7001. | It must not appear as currently eligible for pickup. | Status remains confirmed because automatic expiry is deferred. Pickup lookup excludes it because now ≥ end. No expiry write should occur. |
| Restricted item attempt | Item `LOCAL-BROWSER-RESTRICTED` / `…0104`, available and restricted; no reservation seeded; student `…0002`, lab 7001. | Submit a valid future date range. Show exact message: “This item requires approval and cannot currently be reserved through UniTrack.” | API returns 403 `restricted_equipment`; no reservation/resource row is inserted. Physical status remains available. |
| Confirmed overlap attempt | Item `LOCAL-BROWSER-OVERLAP` / `…0105`; reservation `…0104`, now +5d to +6d, confirmed; borrower `…0002`, lab 7001. | Attempt same item for +5d12h to +6d12h; show a useful conflict message. | API returns 409 `reservation_conflict`; exclusion constraint rejects any racing insert; no second confirmed reservation/resource row. |
| Kit reservation with components | Kit main item `LOCAL-BROWSER-KIT` / `…0106`; tracked components `…0107` Camera and `…0108` Cable, all available/unrestricted, same lab. No reservation seeded. | Select main kit and dates within the next 14d, duration ≤7d; confirm. Component list is visible through kit details. | API creates one confirmed reservation owned by student `…0002`/lab 7001 and resources for main + both components. Equipment statuses remain available. |
| Booked kit blocks component | Kit `LOCAL-BROWSER-BOOKED-KIT` / `…0109`, tracked component `…0110`; reservation `…0105`, now +7d to +8d, confirmed, same borrower/lab. | Attempt to reserve component `…0110` for any overlapping part of +7d to +8d. | API returns 409; confirmed-only resource exclusion prevents overlap with the kit reservation. |
| Booked component blocks kit | Kit `LOCAL-BROWSER-TARGET-KIT` / `…0111` contains component `…0112`; reservation `…0106` books component `…0112` from +9d to +10d, confirmed, same borrower/lab. | Attempt to reserve kit `…0111` overlapping +9d to +10d. | API returns 409; no kit reservation/resource rows inserted. |

Removing a component from a kit changes its current membership, but it does not
release the component from an already confirmed kit reservation. The
`reservation_resources` rows are the reservation-time snapshot and continue
to block overlapping standalone or kit bookings until that reservation leaves
`confirmed` status.

For the current-eligibility check, keep the test browser/service clock aligned
with the local database clock. The direct fixture seed creates only the listed
historical/active reservations; the kit success scenario must be created
through the browser/API so it also verifies the live reservation path.

## Remaining external handoff

- **SC:** point the local app to the disposable database, run the browser cases
  above, and report observed UI/API results. The fixture only supplies data; it
  does not assert that SC's pickup navigation has been enabled in the combined
  branch.
- **NH:** rerun the S2-09 restricted-role completion/recovery/compensation tests
  against the real S2-01 permission and status guard migrations after PR #28 is
  updated. The S2-09 remote branch is not merged into `origin/main` at this
  inspection point.
