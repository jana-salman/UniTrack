# UniTrack migration handoff

Current branch: architecture/microservices. Scope ends at Equipment extraction. Users and Loans extraction have NOT begun. No live SQL, shared-data writes, production provisioning, deployment, push or merge was performed. Private environment files were never opened, read, copied, modified or displayed during this extraction/review.

## Completed architecture stages

1. Baseline from origin/main 001f952252229aa6172b7b59da5caf82a231c0b4; local tag monolith-baseline. Workspace move committed as 487e717671dfff3054d2be136e49745d322c4ce3.
2. Shared API/error/identity contracts and HS256 internal authentication, committed as fba34e671522ed22e16a8712a277ac9f7fa4f1ff. Internal tokens require verified signatures, issuer, exact 60-second lifetime and typed user/service identity claims; callers explicitly supply the secret.
3. Four independently runnable Next.js apps, process-health endpoints, auth fixtures, server-only gateway helper and Windows dev:all process management, committed as 4d988e8152e2673dbbbd5f08ba9b89a3463b1c9e.
4. Equipment extraction and focused review in the current change. See equipment-extraction.md for endpoint/role tables and detailed source provenance. This is a partial migration, not completed microservices.

## Running architecture

Browser requests retain their existing /api URLs. Web validates the existing Supabase session, allowed university domain, provisioned matching active profile and lab. Only that verified profile supplies internal identity; browser Authorization, role/user/lab fields cannot set claims. Web signs a short-lived token and calls the configured Equipment origin over HTTP. Equipment independently verifies the token, role and lab before database access.

Equipment owns equipment_categories, equipment_items, kits, kit_components and equipment_status_history. Categories remain global Equipment reference data because their existing schema has no lab column; item/component operations use the signed lab. Service identities cannot masquerade as user actors. Status retirement remains manager-only. Web has no Equipment SQL or production imports of Equipment implementation. Its remaining pg/profile access belongs to the future Users extraction. Existing pages, components and browser success shapes are preserved; QR/UI validation helpers do not access the database.

Equipment provides authenticated catalogue/categories/manager-list/create/edit/status routes plus ID lookup, maximum-100-ID batch lookup, availability and component lookup. Only /health is public. Users and Loans still expose skeleton health endpoints, not domain APIs.

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
| Web: existing identity/profile access | DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, ALLOWED_EMAIL_DOMAINS |
| Web: Equipment gateway | EQUIPMENT_SERVICE_URL, INTERNAL_JWT_SECRET |
| Equipment | DATABASE_URL, INTERNAL_JWT_SECRET |
| Users/Loans skeleton templates | INTERNAL_JWT_SECRET (health does not require it) |
| Reserved web template entries for later phases | USERS_SERVICE_URL, LOANS_SERVICE_URL |

Public .env.example templates contain only placeholders. An operator must provision matching internal signing configuration for web and Equipment and the correct pooled Equipment database connection, using trusted server configuration. No values or persistent credentials are supplied here. Web and Equipment have separate application roots; root private configuration is not a substitute for the web/service roots. Do not copy, inspect or overwrite existing private files as part of this handoff. Missing Equipment URL/secret never falls back to local SQL or a fallback credential.

## Database readiness and migration order (none executed here)

Review-only text changes are in database/migrations. Application commands never run migrations or seed/reset scripts.

| Order | File/readiness | Existing shared development | Fresh database |
| --- | --- | --- | --- |
| 0 | Baseline expanded schema and immutable-history triggers: database/schema.sql and database/triggers.sql; 002_expand_model.sql is the earlier expansion path for older databases | Do not recreate/reset the baseline; live state was not queried | An owner must establish the normal expanded baseline and triggers first; do not blindly apply both schema creation and the legacy expansion path |
| 1 | C430PRJCT-41_status_request_key.sql | User reports already applied; do NOT rerun it | Owner reviews/applies it after baseline |
| 2 | 003_equipment_request_fingerprint.sql | New; remains unapplied by this work | Owner reviews/applies after request_key readiness |

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

Catalogue expectedReturn is always null until Loans aggregation. Equipment availability reports only Equipment-owned state; it does not promise a conflict-free reservation or enforce Loans windows/limits. Users/profile SQL remains in web, and database roles/RLS do not yet enforce service isolation. Cross-owner foreign keys are still present. Equipment configured authenticated workflows require manual secret/URL/database/schema readiness. The UI has not been redesigned. Users and Loans are still skeletons.

## Preserved return branch integration

Branch feature/C430PRJCT-41-return-equipment stays at 3f220aa090d1774f112ba888cd509bfa408461b7; no merge/rewrite occurred.

1. In a separately authorized task, integrate its added return UI/API/tests at apps/web paths and then place loan/reservation/condition-record logic in Loans. Do not recreate root app/lib/tests directories.
2. Do not reapply its old web Equipment status transaction or import the Equipment implementation. The selectively reused request_key migration is already included under the same filename; reconcile history rather than duplicate/reapply it.
3. Replace the return-equipment SQL/in-process adapter with authenticated Equipment HTTP calls using the verified user identity. Map lab_id to labId and component_name to name. Handle equipment_status_conflict/idempotency_key_conflict by API code, not a cross-service exception class.
4. Review its per-attempt random operation key before retries: use a stable logical operation identity, preserve expected-status/fingerprint semantics and handle original changed/alreadyApplied results. Reconcile legacy receipts explicitly; do not rewrite immutable history.
5. Review its actual-prior-status compensation and uncertain-commit safeguards separately. A replay may describe an old result while current Equipment state has advanced. Never blindly restore equipment after an ambiguous HTTP failure. Move and rerun return tests; add real cross-service fault/retry/reconciliation scenarios before rollout.

## Remaining work by boundary (not implemented)

### Users

Extract profiles/roles/lab membership into Users, add profile/batch/role endpoints and replace web profile SQL. Keep Supabase session/domain checks in web; remove web pg/DATABASE_URL only after its last profile read is migrated.

### Loans

Integrate completed Sprint 2 work, extract reservations/loans/conditions, implement overlap checks, handover/return orchestration and HTTP Equipment adapter. Add due-date/name aggregation while keeping privacy rules; restore catalogue expectedReturn only after this exists.

### Database isolation

Review/apply pending schema work separately; create per-service roles/grants/RLS, test denied cross-owner access and identity sequence grants. Decide explicitly on optional cross-owner foreign-key removal. No destructive resets or audit-history backfills are implicit.

### Integration testing

Use a separately authorized isolated real PostgreSQL/test-auth environment for parallel requests, history-failure rollback, uncertain commits and real HTTP services. Then verify real login/role/lab flows, return compensation, crash reconciliation and phone workflows. Current mocks do not replace this stage.

### Deployment

Prepare separate web/Users/Equipment/Loans projects, manual server configuration, pooled connections and deployment protection. Build shared exports before each app build; root-directory/install/build settings require review. No live Vercel settings have changed. Deploy/redeploy proof, logging/tracing evidence and demo documentation remain later tasks.

## Final review results

All final workspace checks passed: type generation, 314 tests across 28 files (web 88, Equipment 143, shared auth 63, Users/Loans skeletons 10 each), lint without warnings, typecheck and all builds. Lockfile dry-run and whitespace checks passed. No existing dependency version changed. Focused review added actionable sanitized readiness failures, explicit read-committed status transactions, recognition of legacy-writer key collisions, separate-connection modeled concurrency tests and static migration-compatibility tests. The code/fixture assertions are not proof of real PostgreSQL behavior or real Supabase-authenticated end-to-end operation. Both migration files remain unexecuted by this work; the user-reported shared request_key readiness was not queried.
