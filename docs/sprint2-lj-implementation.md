# Sprint 2 implementation notes: LJ

This note records the S2-01, S2-02 and S2-05 work in
`feature/S2-01-reservation`. Jira itself is not connected to this workspace, so
the card checks below map to the acceptance criteria supplied in the task and
the checked-in database model. No card status or Jira issue was changed.

## S2-01: reserve an item

Web keeps the authenticated session and forwards requests to Loans. Loans
accepts only a verified student token, derives borrower and lab from that
identity, and validates the selected item and any tracked kit components over
the Equipment HTTP API. Only `available`, unrestricted equipment can be
reserved. The restricted item response uses the approved exact message.

The API permits a start at the current instant, an inclusive maximum of seven
days between start and end, and a start at the inclusive fourteen-day advance
boundary. It rejects past starts and reversed or malformed ranges. The browser
offers date-only selection and sends an exclusive end at the start of the day
after the selected end date. A successful insert is `confirmed`; the response
contains the saved row and the UI displays an immediate confirmation. Future
reservations never update `equipment_items.status`. Notifications remain out
of scope.

The S2-01 migration grants only the reservation INSERT columns, the `status`
UPDATE column, and a confirmed-only INSERT policy. It requires the real S2-09
`handover_operation` column and update policy. The teammate branch is available
as `origin/feature/s2-09-handover-nh-v2`, but is not an ancestor of
`origin/main` and its migration is absent from this checkout. The disposable
runner streamed that committed migration directly into its local database,
verified S2-09, then applied and verified S2-01. The S2-01 migration and
verifier are included in the already-pushed PR #28. The follow-up reservation status guard
does not change S2-09 grants or RLS.

## S2-02: no double booking

The existing `reservations_no_overlapping_confirmed` GiST exclusion constraint
was verified and left intact. It uses half-open `[)` ranges and filters to
confirmed rows. The Loans writer maps `23P01` to a 409 conflict and also
pre-checks resource conflicts for a clear response. The local SQL assertions
exercise overlaps, adjacency, distinct items, pending and cancelled rows; the
disposable PostgreSQL integration suite exercises concurrent requests.

The S2-02 branch is an ancestor of `origin/main` and its migration is already
in the current tree. No S2-02 migration change was made.

## S2-05: kit components

The implementation uses the existing model: the main QR/asset code is an
`equipment_items` row referenced by `kits.item_id`; tracked components are
active `kit_components` rows. Lab managers can create a kit, edit its details,
retrieve its components, add components later, and soft-remove them. QR labels
reuse the existing equipment QR component. Component validation rejects
duplicates, cross-lab or missing items, kits nested as components, restricted
items and non-available items.

Migration `S2-05_kit_management.sql` adds active tracked-item uniqueness,
database lab-integrity triggers, a confirmed-only exclusion constraint over
the resources used by reservations, and narrowly scoped service grants/RLS.
Kit component edits take the shared Loans item advisory lock and synchronize
resource rows for active kit reservations. A kit and its individually tracked
components therefore cannot be booked over one another, including concurrent
attempts. Removing a component releases it from future kit resource checks;
the physical equipment status is not changed by reservation writes.

## Migration and verification

The repository's existing order remains 003 → 004 → 005 → 006 → S2-02 →
S2-09 → 007. S2-05 follows 007 in the disposable harness; S2-01 follows the
real S2-09 and 007 prerequisites (and can follow S2-05). No shared database is
modified. In that chain, S2-05 follows 007 and S2-01 follows S2-05; its verifier
also checks preservation of S2-09's separately owned permissions. The complete
chain and focused database-backed kit/reservation tests passed against the
disposable PostgreSQL container.

The C3/C4 follow-up adds a database trigger that blocks reservation status
changes while a handover operation is not confirmed compensated, blocks
confirmed reservation invalidation when a loan row exists, validates the
applied-to-completed fulfillment against its matching loan and pickup record,
and makes fulfilled status terminal. It leaves S2-09 operation writes, RLS,
and grants unchanged. Restricted-role PostgreSQL tests cover handover,
recovery, compensation, post-compensation loan protection, confirmed-detail
permissions, terminality, and the item-lock race. Kit reservation creation
acquires all parent/component locks in global order, rechecks item eligibility
and kit membership under those locks, and preserves each confirmed booking's
component resource snapshot if the current kit membership later changes. There
is no production cancellation/expiry writer; future writers must take the
shared Loans item transaction lock before locking the reservation row.

On 2026-11-21, the disposable local migration harness passed migrations
003–007, S2-01, S2-02, S2-05 and S2-09 verification, plus 22 PostgreSQL
integration cases (3 kit, 6 service migration, 5 reservation, 8 reservation
status guard). The final unit suite passed 627 tests; its 22 database-backed
tests were skipped in the non-database run because they were separately run
by the local harness. Repository lint and typecheck passed. The initial
production build stopped finalization on the Next.js security vulnerability warning. After the
approved minimal update of `next` and `eslint-config-next` to 16.4.5, all four
production builds passed without the warning. The browser fixture seed was
loaded and verified in the disposable local database. See
[the S2-01/S2-05 browser fixture and C1-C6 matrix](s2-01-s2-09-compatibility-and-browser-fixtures.md).

Use `npm run typegen`, `npm run typecheck`, `npm test`, `npm run lint`, and
`npm run build` from the repository root. Run
`& .\database\local-test\run.ps1` with Docker Desktop for the local migration
and PostgreSQL integration suites.

## Review boundary

Current Git evidence at this continuation: branch
`feature/S2-01-reservation` is at `c6b730bbea9653e54f54a16f62647056228a95f2`
before these uncommitted handoff corrections. S2-02 is merged into
`origin/main`; S2-09 has a remote branch but is not merged into it; no Jira
connector is available. This continuation has not committed or pushed its
changes and has not applied anything to a shared database. Coordinate
integration with NH and browser acceptance with SC, then record the result on
the cards.
