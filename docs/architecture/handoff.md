# UniTrack migration handoff

Current task branch: architecture/loans-service, created from the clean reviewed/fetched Users checkpoint ba735668469aa3b9d2e14272547685a7b523380c. Local/remote Users and return refs matched; no unexpected divergence. Existing return work was selectively migrated from 3f220aa090d1774f112ba888cd509bfa408461b7 without merging or changing its branch. This task implements Loans returns and catalogue due dates only, and is locally committed by the focused-review task after verification. No live SQL, shared-data writes, provisioning, deployment changes, push or merge occurred. Private environment files were not opened, read, copied, modified or displayed.

**Current return implementation, migration order, retry/compensation contract and limitations:** see [loans-returns-extraction.md](loans-returns-extraction.md). Prior stage verification records below are historical. This remains a partial migration, not a completed borrowing system.

## Completed architecture stages

1. Baseline from origin/main 001f952252229aa6172b7b59da5caf82a231c0b4; local tag monolith-baseline. Workspace move committed as 487e717671dfff3054d2be136e49745d322c4ce3.
2. Shared API/error/identity contracts and HS256 internal authentication, committed as fba34e671522ed22e16a8712a277ac9f7fa4f1ff. Internal tokens require verified signatures, issuer, exact 60-second lifetime and typed user/service identity claims; callers explicitly supply the secret.
3. Four independently runnable Next.js apps, process-health endpoints, auth fixtures, server-only gateway helper and Windows dev:all process management, committed as 4d988e8152e2673dbbbd5f08ba9b89a3463b1c9e.
4. Equipment extraction and focused review committed at a31bebd815eac20a49ea5f36ace0193cacd6cf5e. See equipment-extraction.md for endpoint/role tables and detailed source provenance. This is a partial migration, not completed microservices.

5. Users extraction committed at ba735668469aa3b9d2e14272547685a7b523380c on architecture/users-service: authenticated profile/role/name endpoints, web HTTP bootstrap, removal of web SQL/pg. See users-extraction.md; no deployment changes are included.

6. Loans return extraction on architecture/loans-service: authenticated returns, durable request-driven Saga, three-second Equipment HTTP adapter, staff-only gateway name aggregation and privacy-safe catalogue due dates. Reviewed return migration; see loans-returns-extraction.md.

## Running architecture

Browser requests retain their existing /api URLs. Web validates the existing Supabase session and university domain, then retrieves the matching active profile from Users over HTTP with a restricted gateway service identity. Only after that bootstrap does it construct a trusted user identity; this avoids circular authentication. Only that verified profile supplies internal identity; browser Authorization, role/user/lab fields cannot set claims. Web signs a short-lived token and calls the configured Equipment origin over HTTP. Equipment independently verifies the token, role and lab before database access.

Equipment owns equipment_categories, equipment_items, kits, kit_components and equipment_status_history. Categories remain global Equipment reference data because their existing schema has no lab column; item/component operations use the signed lab. Service identities cannot masquerade as user actors. Status retirement remains manager-only. Web has no Equipment SQL or production imports of Equipment implementation. Users now owns all profile SQL. Web no longer has pg, lib/db.ts or direct profile/lab SQL. Existing pages, components and browser success shapes are preserved; QR/UI validation helpers do not access the database.

Equipment provides authenticated catalogue/categories/manager-list/create/edit/status routes plus ID lookup, maximum-100-ID batch lookup, availability and component lookup. Only /health is public. Users now serves authenticated profile lookup/list/batch/role operations as detailed in users-extraction.md. Loans now owns reservations, loans and condition_records and implements authenticated return details/confirmation and privacy-safe due dates. Web uses HTTP and read-only name/date aggregation; no direct SQL. Unbuilt reservations/handover/inspection resolution are not implemented.

## Startup commands

From the repository root on Windows PowerShell (also ordinary npm commands elsewhere):

```powershell
npm ci
npm run dev:all
```

The pre-hook builds shared package exports. Apps use web 3000, Users 3001, Equipment 3002 and Loans 3003. Ctrl+C stops all children. The previous skeleton review also tested a deliberate port collision: dev:all exited nonzero and killed siblings. Equipment extraction startup/health and final shutdown were checked separately.

For independent development:

```powershell
npm run build:packages
npm run dev --workspace=@unitrack/equipment
```

For production-mode local processes, build at root, then start each command in a separate terminal:

```powershell
npm run build
npm run start --workspace=@unitrack/web -- --port 3000
npm run start --workspace=@unitrack/users
npm run start --workspace=@unitrack/equipment
npm run start --workspace=@unitrack/loans
```

The extraction startup smoke used dev:all, not a full authenticated production-mode deployment. Missing business configuration must be completed manually by an authorized operator before real workflows; health and unauthenticated rejection need no database credentials.

Public checks while apps run:

```powershell
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:3002/health
Invoke-RestMethod http://localhost:3003/health
(Invoke-WebRequest http://localhost:3000/unauthorized -UseBasicParsing).StatusCode
```

## Configuration names only

| Runtime | Names |
| --- | --- |
| Web: existing identity/session access | NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, ALLOWED_EMAIL_DOMAINS |
| Web: Users bootstrap and user operations | USERS_SERVICE_URL, INTERNAL_JWT_SECRET |
| Web: Equipment gateway | EQUIPMENT_SERVICE_URL, INTERNAL_JWT_SECRET |
| Equipment | DATABASE_URL, INTERNAL_JWT_SECRET |
| Users | DATABASE_URL, INTERNAL_JWT_SECRET |
| Loans | DATABASE_URL, INTERNAL_JWT_SECRET, EQUIPMENT_SERVICE_URL, LOANS_DATABASE_SESSION_AFFINITY |
| Web: Loans returns and catalogue due dates | LOANS_SERVICE_URL, INTERNAL_JWT_SECRET |

Public .env.example templates contain only placeholders. Loans requires a direct or session-pooled database URL plus explicit session-affinity acknowledgement before creating its pool; transaction-mode pooling is incompatible with its session advisory lock. See loans-returns-extraction.md and the readiness guard. An operator must provision matching internal signing configuration for web, Users and Equipment and the correct pooled Equipment database connection, using trusted server configuration. No values or persistent credentials are supplied here. Web, Users and Equipment have separate application roots; root private configuration is not a substitute for the web/service roots. Do not copy, inspect or overwrite existing private files as part of this handoff. Missing Equipment URL/secret never falls back to local SQL or a fallback credential.

## Database readiness and migration order (none executed here)

Review-only text changes are in database/migrations. Application commands never run migrations or seed/reset scripts.

The reusable read-only remaining-prerequisite check and ordered staging plan are
in [database/verification/preflight_003_005.sql](../../database/verification/preflight_003_005.sql)
and [database/MIGRATIONS_003_005.md](../../database/MIGRATIONS_003_005.md).
They do not execute migrations or replace owner approval.

Subsequent owner-reported read-only verification confirmed all ten baseline
tables, the nullable request-key column and correct valid/ready unique partial
index, and all four enabled baseline protection triggers. The 003, 004 and 005
target columns were absent. The extraction-stage statements below that no live
query had yet occurred remain historical evidence for that earlier task.

| Order | File/readiness | Existing shared development | Fresh database |
| --- | --- | --- | --- |
| 0 | Baseline expanded schema and immutable-history triggers: database/schema.sql and database/triggers.sql; 002_expand_model.sql is the earlier expansion path for older databases | Owner reports all ten tables and four baseline protection triggers verified; do not recreate/reset the baseline | An owner must establish the normal expanded baseline and triggers first; do not blindly apply both schema creation and the legacy expansion path |
| 1 | C430PRJCT-41_status_request_key.sql | Owner reports nullable text column and correct valid/ready unique partial index verified; do NOT rerun it | Owner reviews/applies it after baseline |
| 2 | 003_equipment_request_fingerprint.sql | Target column verified absent; remains unapplied | Owner reviews/applies after request_key readiness |
| 3 | 004_loans_return_operation.sql | Target column verified absent; remains unapplied | Owner reviews/applies after Equipment key/fingerprint readiness; adds nullable Loans plan JSONB, no audit rewrite |
| 4 | 005_equipment_operation_guard.sql | Target column verified absent; remains unapplied | After prior readiness, install nullable item ownership and item-status/history-insert triggers before enabling returns. Existing history is untouched. |

The request-key file is an exact selective copy from preserved return branch 3f220aa. It adds a nullable request_key if absent and a unique partial index on non-null keys. Existing null keys are compatible. Existing non-null duplicates would prevent unique-index creation; any remediation requires a separately authorized owner decision, not deleting immutable audit history.

The fingerprint migration adds nullable request_fingerprint if absent. Neither migration updates/deletes old history, disables immutable triggers, backfills existing receipts, changes key types or makes old rows non-null. DDL column addition does not invoke the row-level UPDATE/DELETE immutability trigger. Existing keyed rows without fingerprints remain valid historical records but cannot be safely replayed as new-format requests; they return a 409 key conflict.

IF NOT EXISTS is not a schema-definition validator. Before enabling keyed requests, an owner must independently confirm existing column types and the named index's unique, valid, non-null-key predicate; the migrations deliberately do not replace an incompatible pre-existing column/index. No catalog query, duplicate scan, migration or real database verification was performed here. Unkeyed status operations keep their original history SQL shape; keyed requests require both new metadata fields and the unique index. Do not enable them against a partially prepared schema.

## Transaction, replay and concurrent-request contract

- BEGIN followed by explicit READ COMMITTED isolation; acquire a transaction advisory lock for any request key, then lock the same-lab item row. Complete key fingerprints bind normalized item, signed actor/lab, target status, normalized reason and canonical expected-status set.
- Exact replay returns the original status/changed result with alreadyApplied:true and performs no second mutation. The current item status may differ; replay is evidence of the prior operation, not a current availability check.
- Different meaningful inputs under one key return 409. Expected-status mismatch is checked under the item lock and rolls back. Legacy keyed history without a fingerprint also fails closed.
- Unkeyed no-op creates no history. Keyed no-op creates one immutable old_status==new_status receipt with changed:false. Item/history/key/fingerprint writes commit atomically; failed history writes roll back the item change and claim no key.
- A global key lock serializes even conflicting requests on different items. Separate keys on the same item serialize through its row lock. The unique partial index is a persistent backstop, including for legacy writers that do not take advisory locks; a recognized key uniqueness collision rolls back and returns a sanitized 409.
- The helper does not retry mutations. Lost connections/timeouts/unknown commit outcomes require reconciliation with the same stable key; never assume an error means no commit or blindly compensate. Unkeyed requests have no durable replay receipt.

Missing schema produces sanitized 503/equipment_schema_not_ready. Missing database or signing setup produces 503/equipment_not_configured once authentication can be attempted; absent token remains 401. Recognized database-access/connection faults produce sanitized 503 codes. Invalid tokens and wrong permissions remain 401/403 when configured. No raw SQL, token, password, host, connection string or nested database error is returned or logged by these paths.

## Exact verification commands and evidence

From root:

```powershell
npm run typegen
npm test
npm run lint
npm run typecheck
npm run build
npm ci --dry-run --ignore-scripts --offline
git diff --check
```

Focused checks after building shared packages:

```powershell
npm run build:packages
npm test --workspace=@unitrack/equipment
npm test --workspace=@unitrack/web -- --run tests/equipment-http.test.ts tests/equipment-boundaries.test.ts
```

Evidence is deliberately separated:

- Original Equipment assertions moved with implementation; the Loans-join assertion was explicitly replaced by expectedReturn:null. Real business-handler tests verify signature rejection, roles and lab query scoping. Boundary tests scan production source for cross-owner SQL and cross-implementation imports.
- The HTTP integration tests use actual web forwarders, signing/fetch, localhost TCP and Equipment handlers. Supabase session/profile lookup and Equipment database are MOCKED; this is not a real logged-in user/database end-to-end test.
- Replay/rollback tests use a transactional fake. Concurrent tests use separate fake connections and an explicit lock model. They substantiate application ordering and outcomes under that model, NOT actual PostgreSQL isolation, advisory locking, uniqueness or crash durability. Migration tests inspect SQL text only; they execute no SQL.
- Dev:all smoke used real Next.js processes: all three public health endpoints and the existing public web page returned 200; all 11 actual Equipment business methods returned 401 with no token. Ports were confirmed closed after shutdown. These were not authenticated domain/data flows.

Real Supabase-to-profile-to-Equipment workflows, live PostgreSQL constraints/locks/triggers/roles, schema readiness, real writes, production deployment protection/networking, independent Vercel redeploys, phone flows and custody/return integration remain UNVERIFIED. Nothing in this handoff claims a real database was exercised.

## Temporary limitations

Catalogue expectedReturn now comes from privacy-safe Loans HTTP aggregation. Failed due-date batches retain Equipment rows with null dates, X-UniTrack-Partial-Data and a visible partial-data notice. Equipment availability reports only Equipment-owned state; it does not promise a conflict-free reservation or enforce Loans windows/limits. Users/profile SQL has left web, but database roles/RLS do not yet enforce service isolation. Cross-owner foreign keys are still present. Equipment configured authenticated workflows require manual secret/URL/database/schema readiness. The UI has not been redesigned. Users and Equipment are extracted; Loans implements returns/due dates only. Full borrowing is incomplete. See the request-driven recovery, session-affinity and unverified-live-workflow limits in loans-returns-extraction.md.

## Preserved return branch integration

Branch feature/C430PRJCT-41-return-equipment remains at 3f220aa090d1774f112ba888cd509bfa408461b7. Its return UI/logic/tests were selectively adapted to the workspace and HTTP boundaries in this task. See loans-returns-extraction.md for the file map, stable operation keys, compensation and uncertain-outcome protocol. Do not merge the old tree, duplicate the request_key migration or restore the in-process Equipment adapter. Compare future changes against that source commit and port by ownership.

## Remaining work by boundary (not implemented)

### Users (implemented, live verification pending)

Users profile lookup/list/batch/role endpoints and database ownership are implemented. Login/actions/authorization/manager pages now use HTTP; web has no SQL/pg dependency. Live Supabase-to-Users/PostgreSQL verification remains unperformed. No additional lab administration or provisioning features were added.

### Loans

Returns and due-date/name aggregation are implemented. Remaining teammate features include reservations/overlap/cancellation, handover/pickup/custody creation, inspection resolution, notifications and other unbuilt Sprint 2/3 work. Do not claim complete end-to-end borrowing. Recovery workers/operator tooling, operation-version ownership and real concurrent/fault verification remain separate integration work.

### Database isolation

Review/apply pending schema work separately; create per-service roles/grants/RLS, test denied cross-owner access and identity sequence grants. Decide explicitly on optional cross-owner foreign-key removal. No destructive resets or audit-history backfills are implicit.

### Integration testing

Use a separately authorized isolated real PostgreSQL/test-auth environment for parallel requests, history-failure rollback, uncertain commits and real HTTP services. Then verify real login/role/lab flows, return compensation, crash reconciliation and phone workflows. Current mocks do not replace this stage.

### Deployment (separate ownership)

Jana is investigating Vercel configuration separately. No settings or deployment fixes were changed in this Users task.

Prepare separate web/Users/Equipment/Loans projects, manual server configuration, pooled connections and deployment protection. Build shared exports before each app build; root-directory/install/build settings require review. No live Vercel settings have changed. Deploy/redeploy proof, logging/tracing evidence and demo documentation remain later tasks.

## Final review results

All final workspace checks passed: type generation, 314 tests across 28 files (web 88, Equipment 143, shared auth 63, Users/Loans skeletons 10 each), lint without warnings, typecheck and all builds. Lockfile dry-run and whitespace checks passed. No existing dependency version changed. Focused review added actionable sanitized readiness failures, explicit read-committed status transactions, recognition of legacy-writer key collisions, separate-connection modeled concurrency tests and static migration-compatibility tests. The code/fixture assertions are not proof of real PostgreSQL behavior or real Supabase-authenticated end-to-end operation. Both migration files remain unexecuted by this work; the user-reported shared request_key readiness was not queried.

## Users extraction handoff

See users-extraction.md for the current audit, endpoint/role/privacy matrix, bootstrap ordering, variable names, test evidence and limits. No Users migration was required or executed; earlier Equipment migration readiness remains unchanged. Public templates only were edited: Users gained DATABASE_URL and web removed it. Private files are untouched. Existing role behavior tests were preserved/moved, and new HTTP tests distinguish fixture Supabase/PostgreSQL from live workflows. The existing Equipment verification record above is historical; final Users results are recorded separately below.

## Users task verification (current)

On architecture/users-service, final typegen/tests/lint/typecheck/build passed. Total: 366 tests / 31 files (web 100, Users 50, Equipment 143, shared auth 63, Loans skeleton 10). Original 314 tests remain represented. Real local HTTP fixtures validated bootstrap, role refresh, restrictions/privacy and failure sanitization with fake Supabase/PostgreSQL. dev:all startup, public health, four unsigned Users method rejections and shutdown were checked; no real authenticated database flow was run. No Users migration, credentials, deployment changes, pushes or merges were performed for this task. Existing Equipment source and return branch are unchanged.

## Users focused review

Verified Supabase-first bootstrap, restricted service/user identities, fresh profile-derived claims, active/known/university account checks, role/lab/privacy enforcement, production SQL/import boundaries and unchanged Equipment/return-branch source. React cache is request-scoped, not a persistent profile/privilege cache; outbound fetch uses no-store. Users revalidates current actor role/lab/active state; existing Equipment JWT lifetime behavior remains unchanged.

Fixed a malformed-body ordering regression: the web role gateway now sends null input to Users for validation after authorization, so a student remains forbidden (403) even with malformed JSON, while an authorized manager receives 400. A real local HTTP fixture regression covers both and confirms no UPDATE. All HTTP tests use isolated Supabase/PostgreSQL fixtures, not real logged-in/database end-to-end verification. Deployment settings and private environment files remain untouched.

## Loans return task verification (current)

On architecture/loans-service from ba735668469aa3b9d2e14272547685a7b523380c, final root commands all passed: npm run typegen, npm test, npm run lint (no warnings), npm run typecheck and npm run build (both packages and all four applications). Total **466 tests / 39 files**: web 127, internal-auth 63, Equipment 151, Loans 75, Users 50. The reviewed Users checkpoint had 366 tests / 31 files; all pre-existing workspace coverage is retained, and the four copied pure return suites add the original 32 return assertions. npm ls --workspaces --depth=0 and git diff --check passed. Lockfile comparison found no added/changed installed dependency versions; only Loans workspace declarations reuse existing pg/@types/pg versions.

Real npm run dev:all started web/Users/Equipment/Loans on 3000/3001/3002/3003. The existing public web page and all three health endpoints returned 200. Actual Loans GET/POST /returns/:loanId and GET /loans/due-dates returned 401 without authentication and without opening the database. Ctrl+C stopped the process group; all four ports were confirmed closed. Production builds passed; production-mode authenticated startup was not exercised. The unchanged Windows startup-failure sibling cleanup was verified in the earlier skeleton phase, not repeated here.

All new authenticated return/data verification uses isolated fixtures: real local HTTP and actual handlers/auth/fetch, mocked Supabase/profile bootstrap and modeled PostgreSQL. No real PostgreSQL statement, migration, constraint/lock/grant verification, shared-data write or live authenticated Supabase-to-database workflow was performed. Migrations 003/004 and new ownership migration 005 remain unapplied by this work. Request-key readiness is user-reported, not queried. A direct/session-pooled Loans database and explicit session-affinity acknowledgement are required; no private runtime configuration was changed. Durable recovery is request-driven and the cross-service/crash limits and ownership-trigger prerequisites are detailed in loans-returns-extraction.md.

The focused-review task records a local commit after final verification. Users implementation and the preserved local/remote return refs are unchanged. Equipment gains only the optional return-compensation ownership guard, with ordinary response/fingerprint behavior preserved. Private/generated/dependency files are excluded from the commit. Jana's deployment work remains separate. No reservation/handover/inspection-resolution/notification feature or later phase was started.

## Loans focused review findings

- Confirmed Loans-only table access, web HTTP aggregation, verified assistant/same-lab return authorization, staff-only names, minimal due-date projection and catalogue retention/partial-data indication. Original return conditions, lateness, active-pickup/future-reservation distinction and duplicate handling remain covered. No complete Sprint 2 borrowing claim is made.
- Fixed a stale-compensation defect: status equality alone allowed an ABA transition to authorize old undo. Equipment now checks expectedOperationKey under its item lock; additive migration 005 records/invalidates causal ownership atomically with status/history, including keyed no-ops and legacy writers. New return generations require the preceding undo's ownership. Existing unguarded status response/fingerprint semantics are preserved. Ownership metadata is not authorization.
- Fixed UUID spelling allowing different advisory lock keys for the same PostgreSQL UUID. Normalized IDs/checklist order are deterministic. A durable plan write must affect exactly one loan; unknown/malformed persisted states and inconsistent completed receipts fail closed.
- Compensation now holds the unreturned loan row lock through its HTTP undo and state commit. Stable keys survive interrupted compensation; uncertain initial/final/compensation COMMIT and unacknowledged ROLLBACK never cause speculative undo. New modeled tests cover commit response loss on both sides, missing writes, corrupted state and another completed action. Actual localhost handlers also reject stale undo after a different Equipment action returns to the same status.
- Migrations 003/004 remain additive and nullable for existing rows, without backfilling immutable history or altering existing request_key data. Order is existing expanded schema/triggers, original request_key readiness, 003, 004, then new 005 before reviewed returns. None was executed. Validate types, indexes, triggers, grants and connection mode separately. Loans requires a direct/session-pooled connection and LOANS_DATABASE_SESSION_AFFINITY acknowledgement; a transaction-mode pooler can invalidate session locking.
- Final focused-review verification passed all root commands: typegen, **466 tests / 39 files** (web 127, auth 63, Equipment 151, Loans 75, Users 50), lint without warnings, typecheck and builds. This adds 19 regression tests to the pre-review 447. HTTP tests use real local transport/handlers with isolated profile/database dependencies; concurrency/commit/trigger models and static SQL inspection are not real PostgreSQL proof. Extraction-stage process startup/shutdown evidence remains recorded above and was not repeated for unchanged process scripts in this review.
- Remaining limits: no background recovery/operator UI, no distributed serializable transaction, possible inter-service change between current-state read and Loans commit, pending live Supabase/PostgreSQL/migration/trigger/pooler verification, and unbuilt reservation/handover/inspection-resolution/notification features. No production settings or private files were changed.
