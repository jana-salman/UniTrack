# Loans return extraction

## Checkpoint and scope

Started with a clean tree. Fetched origin; local and remote architecture/users-service matched the reviewed ba735668469aa3b9d2e14272547685a7b523380c checkpoint. Local and remote feature/C430PRJCT-41-return-equipment matched 3f220aa090d1774f112ba888cd509bfa408461b7. No unexpected divergence or existing architecture/loans-service branch was found. Created architecture/loans-service from that Users commit. No merge, branch overwrite or deployment change occurred. The focused-review task authorizes the local commit; no push or merge is included.

Read AGENTS.md, the v2 Word plan, prior extraction/migration records and the installed Next.js 16.4.4 route-handler documentation. The v2 warning about per-attempt random keys and uncertain outcomes applies to the old return Saga; it was redesigned rather than copied unchanged.

This implements the existing return feature and catalogue due-date integration only. Reservation creation, reservation overlap checks, handover, inspection resolution, notifications and other unbuilt Sprint 2/3 features remain absent. There is no complete end-to-end borrowing workflow.

## Selectively migrated source

Source is return branch commit 3f220aa, inspected read-only throughout:

| Source before workspaces | Current destination / treatment |
| --- | --- |
| app/(protected)/return/[loanId]/{page,return-details,return-actions,return-form}.tsx | Same relative browser page under apps/web. Server-authoritative validation lives in Loans; form-only choice feedback stays client-side. Existing URL, checklist, notes, new-damage control, completion and uncertain-result blocking behavior are preserved. Staff borrower names and missing-label notice come from gateway aggregation. |
| lib/returns/{checklist,inspection,rules,validation,queries,save-records}.ts | services/loans/lib/returns. Original business assertions and same-lab SQL were retained. |
| lib/returns/types.ts and equipment-port.ts | Shared pure DTO types in packages/contracts; Loans owns the Equipment port. Web re-exports types only, with no import of a service implementation. |
| lib/returns/service.ts and transaction.ts | Replaced by the durable, serialized Saga in Loans service.ts. The old in-process transaction wrapper is not used. |
| lib/clients/return-equipment-client.ts | Replaced by services/loans/lib/equipment-http.ts. No Equipment SQL or implementation imports. Names/components are web-owned HTTP aggregation. |
| app/api/returns/[loanId]/route.ts | Thin browser gateway in apps/web plus authenticated Loans handlers. The gateway keeps origin checking; Loans owns validation, authorization and persistence. |
| tests/return-{checklist,inspection,rules,validation}.test.ts | All 32 assertions copied to Loans with import-path adaptation. Service and API assertions adapted to the new durable protocol and real local HTTP fixtures. |
| Equipment transaction, tests and request_key migration | Already selectively integrated in the earlier Equipment checkpoint; neither duplicated nor restored from the old application tree. |

Original return-service cases remain covered: clean return; Equipment failure; local rollback and restoration; restoration failure; ambiguous commit without undo; already-returned loan; cross-lab Equipment; student denial. API cases remain covered through real handlers: success, missing authentication, denied role, invalid lab/ID, scoped not-found and sanitized failures. Architecture-specific readiness failures now use sanitized 503 responses rather than the old logged raw exception/500 path.

## Endpoints and ownership

Loans SQL accesses only reservations, loans and condition_records. No Equipment or Users query/import remains in Loans or web. Existing cross-owner database foreign keys remain; database isolation is a later phase.

| Endpoint | Authorization / behavior |
| --- | --- |
| Loans GET /health | Public process health, no schema or credentials exposed. |
| Loans GET /returns/:loanId | Verified lab_assistant user only; UUID and signed lab scope. Loan and pickup conditions only, no cross-owner labels. |
| Loans POST /returns/:loanId | Verified lab_assistant user only; UUID, bounded checklist/body fields, signed actor/lab. Returns loanId, returnedAt, status, isLate. Same normalized input/actor replays a completed return; different input/actor conflicts. |
| Loans GET /loans/due-dates?itemIds= | Verified user of any existing role, same-lab unreturned loans, at most 100 submitted UUIDs before deduplication. Explicit projection returns itemId and dueDate only; no borrower, loan, reservation or condition data. Service identities are rejected. |
| Web GET/POST /api/returns/:loanId | Existing verified Supabase/profile bootstrap then signed user HTTP request to Loans. Browser roles, IDs, lab headers and Authorization do not supply trusted claims. GET aggregates Equipment item/components and Users same-lab staff names. POST only forwards. |
| Web GET /api/items | Existing Equipment catalogue plus bounded Loans due-date batches. The successful array shape remains unchanged. Failed batches retain their items with null expectedReturn, set X-UniTrack-Partial-Data: loans-due-dates and show a catalogue notice. |

Users name aggregation is performed only after Loans authorizes the lab assistant. Users additionally enforces its staff and lab policy. Students cannot obtain borrower names through return details or the due-date endpoint. Privileges are refreshed by the existing web Supabase-first profile bootstrap on subsequent requests; service tokens retain their existing 60-second validity. Users implementation is unchanged. Focused review adds an optional Equipment ownership guard solely to protect return compensation/restart; ordinary status response shapes and pre-existing request fingerprints remain unchanged, and existing assertions are retained.

## HTTP and readiness

The web gateway uses the existing five-second caller. Loans calls only its configured Equipment origin, with a verified user identity, shared signed request ID and three-second AbortController timeout covering headers AND body reading. It signs a fresh short-lived internal token. It forwards no browser cookies/Authorization and accepts no browser destination URL. There is no automatic mutation retry. A request retry is mediated by the persisted Saga and uses the same remote key for that step.

Equipment HTTP bodies are projected/validated; raw upstream errors, credentials, tokens and transport exceptions are never logged or returned. Only approved Loans error messages/codes cross the web gateway. Missing URL/signing/database setup, missing columns/tables/permissions and ambiguous writes fail closed with sanitized 503 responses. Missing/invalid/expired token is 401; wrong role/service identity is 403; wrong-lab loans are 404.

Public templates contain empty placeholders only. Required names:

| Runtime | Names |
| --- | --- |
| Web session/bootstrap | NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, ALLOWED_EMAIL_DOMAINS |
| Web internal calls | USERS_SERVICE_URL, EQUIPMENT_SERVICE_URL, LOANS_SERVICE_URL, INTERNAL_JWT_SECRET |
| Users | DATABASE_URL, INTERNAL_JWT_SECRET |
| Equipment | DATABASE_URL, INTERNAL_JWT_SECRET |
| Loans | DATABASE_URL, INTERNAL_JWT_SECRET, EQUIPMENT_SERVICE_URL, LOANS_DATABASE_SESSION_AFFINITY |

An authorized operator must configure the individual app/service runtimes manually. Internal signing configuration must match across callers and verifiers. Loans needs a **direct or session-pooled PostgreSQL connection**: transaction-mode pooling is incompatible with its session advisory lock across commits. Its explicit session-affinity acknowledgement is checked before creating the pool (see services/loans/lib/db.ts for the accepted non-secret acknowledgement). Missing acknowledgement fails closed; the code cannot independently prove a pooler's mode. Do not enable it without verifying the connection mode. Health/unsigned rejection and fixture tests need no database. Production secret provisioning and real database verification remain separate, unperformed setup steps. No private environment file was inspected, copied, modified or displayed.

## Durable return protocol

1. After validation, take a session advisory try-lock keyed by loan ID on a dedicated checked-out pool connection. Another concurrent attempt receives 409. It is released on completion; uncertain connections are destroyed. Session affinity is required across every local commit.
2. Lock/read the same-lab loan. For a new return validate the full pickup checklist, read Equipment over HTTP, require checked_out/overdue, compare existing/new damage, and query only confirmed reservations active at the accepted return time. Future reservations do not reserve the just-returned item. Missing/unknown/newly damaged items require inspection. Store a durable return_operation JSON plan on the loan, require exactly one affected row, and COMMIT it **before** changing Equipment. UUID spelling is canonicalized before acquiring the lock, and persisted operation state/types are validated before recovery.
3. The plan binds the normalized checklist and assistant fingerprint, accepted return timestamp/outcome, actual prior status and stable UUID-based operation key/generation. Reordered conditions and blank/absent notes normalize consistently. Keys and actor IDs are tracing/replay metadata, not credentials or authorization. Authorization is reverified on every request.
4. Apply Equipment status with expectedStatus equal to the recorded prior status and a stable ':attempt:apply' key. A lost response leaves the plan retryable with the exact same key and inputs. Check current Equipment state after a replay: a historical receipt alone is not evidence of current status. No-op/unexpected results fail closed without local writes or blind undo.
5. Atomically update returned_at, insert all return condition records and persist the completed result in one local transaction. Lateness derives from stored due_date and the accepted return timestamp, which is frozen across retries. New-damage notes are recorded. No historical condition/history rows are rewritten or deleted.
6. Only a positively acknowledged local rollback permits compensation; check the loan was not independently returned before undo. Persist compensating intent, then hold the still-unreturned loan row lock through undo and its local state commit (also on resumed compensation). Restore the actual previous status using expectedStatus equal to the attempted target, expectedOperationKey equal to the original apply key and a stable ':attempt:undo' key. The Equipment ownership check is under its item lock. Another keyed action/no-op, unkeyed status change or explicit direct status write invalidates ownership, including ABA changes back to the same value. A conflicting status/owner or lost response remains uncertain. Retry replays the same undo receipt; it never overwrites a different current status.
7. Only confirmed compensation transitions to compensated. A later retry with the same input allocates a new attempt generation guarded by ownership of the previous undo; it cannot mistake the original apply receipt for a newly applied change. Completed replays return the stored result without another write. Different meaningful input/assistant yields 409 rather than reusing an operation.
8. A failed COMMIT or unacknowledged ROLLBACK is uncertain even if an error was returned. NEVER compensate it blindly. Retry reads durable state on a fresh connection: a committed return replays, and a rolled-back local transaction can finish under the original plan after checking Equipment.

Confirmed Equipment rejection produces a sanitized conflict; a possibly committed remote call produces an uncertain failure. Neither causes speculative undo. An interrupted initial plan COMMIT cannot cause an Equipment write because Equipment is contacted only after acknowledged plan persistence.

## Migration order — review/apply separately, NONE executed here

1. Establish the existing expanded schema and its immutable-history/delete-protection triggers using the repository's normal baseline path. Older installations use 002_expand_model.sql; do not blindly apply a second baseline or reset existing data. Live readiness was not queried.
2. C430PRJCT-41_status_request_key.sql: already present, user reports applied to shared development. Do not duplicate or rerun it there. A fresh database needs the existing reviewed column/unique-index migration.
3. 003_equipment_request_fingerprint.sql: required for stable Equipment keyed requests; unapplied by this work. Existing receipts without a fingerprint remain immutable and fail closed on replay. Existing incompatible columns/indexes require owner review, not replacement/backfill/deletion.
4. **New 004_loans_return_operation.sql**: adds one nullable JSONB column on loans, compatible with existing rows (NULL). No backfill, history rewrite, trigger disabling, new table, credential or infrastructure. Required before return confirmation. It remains unapplied by this work.
5. **New 005_equipment_operation_guard.sql**: Equipment-owned nullable status_request_key on items, plus BEFORE status-update and AFTER history-insert triggers. Existing items start unowned (NULL); no historical row is rewritten, deleted or backfilled. The triggers clear stale ownership and atomically record the new keyed operation in the existing status/history transaction, including legacy writers. This is required before enabling the reviewed Loans Saga. Remains unapplied.

No migration runner was added to startup/build/test. Existing migration files and immutable-history protections were not changed. Migration 005 only defines the new item-ownership triggers for later application; shared database schema/data were not accessed. IF NOT EXISTS does not validate existing column types/index definitions; owner verification is still required. Database roles must eventually restrict each service to its owned tables and necessary sequence/function access.

## Evidence and limits

The four pure return test files retain their original assertions. New service tests use a transactional in-memory model with distinct modeled connections/locks. Real localhost HTTP fixtures exercise actual web forwarders, Loans/Equipment/Users handlers, signing/verifying and native fetch; ONLY profile-bootstrap and database dependencies are mocked. They cover lab/role/privacy restrictions, clean/missing/damaged returns, duplicates/concurrency, stable-key replay, response loss after Equipment commit, body timeout, rollback/undo, compensation conflict and response loss, ambiguous local COMMIT on either side, due-date projection and catalogue partial failure. No fixture executes SQL or contacts real Supabase/PostgreSQL. Existing Equipment and Users assertions remain present; focused Equipment guard/ABA and migration-shape tests were added.

These tests do **not** prove real PostgreSQL locking/isolation/commit durability, pooler affinity, grants/RLS, migration readiness, live Supabase login, foreign-key behavior, real concurrent writes or a production distributed workflow. Startup smoke is process/HTTP readiness plus unsigned rejection, not authenticated data verification.

Recovery is request-driven; no durable worker/outbox, automatic reconciliation screen or background compensation exists. A crash can leave a planned/applied/compensating operation until the same assistant retries identical information or an authorized operator reconciles it. Compensated retries keep the original accepted timestamp/input. Conflicting or inconsistent state must be reconciled manually; changing assistants/input cannot silently replace the recorded plan. Network partitions can retain the server session lock until PostgreSQL detects disconnection. Reviewed compensation/restart now requires Equipment operation ownership, so an ABA change cannot authorize stale undo when migration 005 triggers are installed/enabled. This relies on those triggers, correct privileges and no operator bypass; real PostgreSQL proof remains pending. A cross-service state change can still race between the read-only current-status check and the Loans local commit. There is no distributed serializable transaction. Verify the ownership triggers, competing writers, recovery tooling and real fault tests before production use. Pre-review pending operations/receipts without the reviewed tracking fingerprint/ownership cannot be silently upgraded or replayed: reconcile them separately without rewriting history. Do not run the legacy return application concurrently against the same data.

## Remaining feature/integration work

- Reservation creation/cancellation/overlap checks and limits are not built here. The existing active-pickup query is read-only and is not a reservation implementation.
- Handover/pickup creation and custody workflows remain teammate work; this feature assumes valid loans and pickup condition rows already exist.
- Inspection resolution, repairs, missing-item handling beyond inspection status, notifications, overdue jobs and other Sprint 2/3 stories remain unbuilt.
- Real PostgreSQL/auth fixture environment, schema/grant/RLS verification, simultaneous writers and crash recovery/reconciliation testing need separate authorization.
- Physical database isolation/cross-owner foreign-key decisions and least-privilege roles remain outstanding.
- Jana owns Vercel separately. No deployment settings/fixes were added. Credential provisioning, service deployment/network protection and production workflow verification remain separate tasks.

The preserved return branch must NOT be merged wholesale later. Its return work is now selectively represented at workspace paths; future teammate changes must be compared against 3f220aa and ported by ownership, preserving the HTTP adapter and durable protocol. Do not restore root app/lib/tests or the old direct-Equipment SQL adapter.

## Final commands and results

From repository root:

```powershell
npm run typegen
npm test
npm run lint
npm run typecheck
npm run build
npm run dev:all
```

All five verification commands passed; lint had no warnings. **466 tests / 39 files** passed (web 127, internal-auth 63, Equipment 151, Loans 75, Users 50), compared with the reviewed Users checkpoint's 366 / 31. The independent app commands and public HTTP checks are listed in handoff.md. dev:all public web/health checks passed; unsigned Loans business handlers returned 401; all four ports closed after Ctrl+C. Real logged-in/database operations and production-mode authenticated startup remain unverified. Git whitespace and workspace dependency checks passed; no existing installed dependency version changed. The focused-review task records the local commit after successful final verification; no push/merge is authorized.
