# Equipment extraction work record

## Map captured before editing

Five web route files own Equipment behavior: /api/items (GET catalogue, POST create), /api/categories (GET/POST), /api/manager/equipment (GET), /api/items/[id] (PATCH), /api/items/[id]/status (PATCH). Their handlers and SQL/query/validation/status libraries move to Equipment internal /items, /categories, /manager/equipment and matching item routes.

Equipment-owned domain tables: equipment_categories, equipment_items, kits, kit_components, equipment_status_history. Catalogue currently joins loans; remove that join and return expectedReturn:null. Categories are globally shared Equipment reference data (no lab_id column); item/component reads/writes must filter the signed lab.

Server pages catalogue, manager/equipment, manager/categories and scan call requirePageProfile only. Their client components fetch the existing /api routes; no direct Equipment SQL or server-page Equipment reads were found. Users/profile queries remain in web for this phase. QR encoding/printing and presentation-only category validation remain web UI utilities without database access.

Nine existing Equipment test files (70 tests) follow their implementation. Adapt route paths and the auth mock signature to Request plus roles, retaining behavior assertions. The catalogue loan-join assertion changes explicitly to the documented temporary null behavior. Additional service/gateway/boundary/HTTP/idempotency tests will be recorded below.

Return branch source: feature/C430PRJCT-41-return-equipment at 3f220aa090d1774f112ba888cd509bfa408461b7, inspected read-only. Reuse item locking, expected-status concept, immutable keyed history and original request_key migration selectively. Do not merge the branch. Its replay matching omits expectedStatus and it does not persist keyed no-ops; extraction must correct both.

## Implemented internal endpoints

All business endpoints require a verified user internal token (issuer unitrack-gateway, HS256, expiry and role/lab claims via shared auth). Service identities are not a substitute for user authorization. Health remains public.

| Endpoint | Roles | Behavior |
| --- | --- | --- |
| GET /items?search=&category= | All four profile roles | Catalogue scoped to signed lab, retired hidden, expectedReturn:null |
| POST /items | lab_manager | Create in signed lab using signed actor, ignore browser lab/created_by |
| GET /categories | All four | Existing global active Equipment taxonomy |
| POST /categories | lab_manager | Existing category creation/validation |
| GET /manager/equipment | lab_manager | Existing full list for signed lab |
| PATCH /items/:id | lab_manager | Existing edit fields, constrained by signed lab |
| PATCH /items/:id/status | lab_manager, lab_assistant | Atomic status/history; retirement manager-only; optional expectedStatus and Idempotency-Key |
| GET /items/:id | All four | Item fields only, same-lab lookup; other labs indistinguishable from missing (404) |
| GET /items/batch?ids= | All four | At most 100 submitted UUIDs, then deduplicate; same-lab rows only; missing/other-lab IDs omitted |
| GET /items/:id/availability | All four | { reservable, status }; available/reserved are potentially reservable |
| GET /items/:id/components | lab_manager, lab_assistant, professor | Same-lab item check, then same-lab kit/component lookup |
| GET /health | Public | Process/service/version only, no DB or credential access |

Equipment uses only its five owned tables. Categories have no lab_id and remain global Equipment reference data, as before. Availability is not a reservation promise: overlap, reservation windows, user limits, restricted borrowing and future-date decisions belong to Loans. No reservation or condition-record SQL exists here.

## Web boundary and meaningful errors

The five existing /api route files are thin forwarders. The gateway calls the unchanged getAuthenticatedProfile helper, which verifies the Supabase user, permitted university domain, profile match and active status. Only that profile supplies subject/role/lab claims; browser Authorization, roles, user IDs, labs and body fields cannot set the internal identity. Request IDs remain tracing labels. Pages and client components are unchanged, and no server-rendered Equipment read bypass was found. Web retains pg/lib/db.ts for Users/profile operations until Users extraction.

The generic HTTP helper now forwards the optional Idempotency-Key and can accept an explicit error-vocabulary contract. Equipment fixed messages/codes and validation-field messages are approved in packages/contracts; no validation or SQL was added there. Arbitrary upstream error fields, credentials and headers are still suppressed. Expected successful JSON and browser URLs remain unchanged. Catalogue expectedReturn is deliberately always null until a later gateway aggregation with Loans. The existing client category validator remains presentation-only; authoritative validation and writes run in Equipment.

## Status requests, replay and no-ops

Derived Equipment-specific code and the exact request_key migration were taken selectively from return branch 3f220aa. No merge or branch changes occurred. The branch's incomplete replay matching and nonpersistent no-ops were not copied.

- Normalize the validated item ID and reason using the existing validator. expectedStatus accepts one valid status or a nonempty list, canonicalized as a sorted unique set. Optional request keys are 1-128 ASCII alphanumeric/colon/dot/underscore/hyphen characters, starting alphanumeric; malformed options fail before SQL.
- BEGIN, explicitly select READ COMMITTED isolation, obtain a transaction advisory lock for a supplied key, then lock the requested item row in its signed lab. Key locking serializes conflicting uses even across different items; the existing unique partial request_key index remains the durable backstop.
- A SHA-256 fingerprint covers normalized item ID, signed lab/actor, target status, normalized reason and the complete canonical expected-status set. A prior receipt with a different fingerprint returns 409; legacy receipts without a fingerprint fail closed as conflicts. No client-level memory cache is used.
- An exact replay returns the original status and changed result with alreadyApplied:true, without checking the now-current status expectation or applying the operation again. Authentication, role/retirement and lab access checks still apply. Replay does not assert the equipment is still in that status.
- A new request checks expectedStatus while holding the item lock, including no-ops. Mismatch returns 409 and rolls back without claiming the key.
- Unkeyed no-op: unchanged item, no history, existing { itemId, status, changed:false }. Keyed no-op: unchanged item but one immutable audit receipt with old_status == new_status; changed:false is replayable. These receipts are intentional audit events, not status transitions.
- Status update (if changed), immutable history row, request key and fingerprint commit in one transaction. History/request receipt failure rolls back the status update. Failed transactions claim no key. There are no automatic mutation retries. A lost response/unknown commit outcome must be reconciled using the same stable key; do not assume failure or blindly compensate after a timeout.

Idempotency is scoped globally by key, bound to actor/lab/item and retained with immutable history. Expected-status set order/duplicates and trimmed reasons are treated as equivalent; other meaningful input changes conflict. The PostgreSQL concurrency/uniqueness behavior is designed into the transaction and migration but was not exercised against live PostgreSQL in this task.

## Required but unexecuted SQL

1. database/migrations/C430PRJCT-41_status_request_key.sql is an exact copy from the return branch. The user reports it is already applied to shared development; do not rerun it there. Fresh databases need its nullable request_key column and unique partial index after the normal baseline schema/triggers.
2. database/migrations/003_equipment_request_fingerprint.sql adds nullable request_fingerprint. It is new and has NOT been applied anywhere by this task. A database owner must review/apply it manually before enabling keyed status requests on an existing or fresh database. Existing history is not updated. No-op receipts use the existing valid history shape (equal old/new); no new table or mutable history mechanism is introduced.

Unkeyed status requests retain their existing SQL shape and do not depend on the new columns. Keyed requests require both migrations. The application never runs migrations or seed/reset commands. No database state, grants, policies or live records were inspected or changed. Existing cross-owner foreign keys remain, so actor/lab references still depend on Users records in the shared database.

## Configuration and manual setup (names only for credentials)

- apps/web: existing Supabase/profile configuration remains; configure EQUIPMENT_SERVICE_URL and INTERNAL_JWT_SECRET in trusted server configuration. The URL must be the Equipment origin, e.g. the local port-3002 origin. Never accept it from a browser request.
- services/equipment: DATABASE_URL and INTERNAL_JWT_SECRET. Only empty placeholders are in .env.example. Web and Equipment must agree on the internal signing secret. Use the appropriate pooled connection string and later an Equipment-specific restricted role. No value is provided or provisioned here.
- Use the existing compatible Node/npm setup, run npm ci at root, npm run build:packages, then npm run dev:all. Shared exports are built by root verification/startup scripts. Equipment's pool is local to its process and capped at three connections. Health and unauthenticated rejection work without database configuration. Authorized Equipment behavior requires configuration and manual schema readiness.

No private environment file was opened, read, copied, modified or displayed. Existing automatic Next.js checks may load web configuration. Missing Equipment URL/secret produces sanitized gateway errors rather than a database shortcut. No live Vercel settings were changed.

## Return branch handoff

The return branch remains at 3f220aa090d1774f112ba888cd509bfa408461b7. Later integrate its added return pages/API/tests at their apps/web locations and move loan/condition domain code into Loans in its own task. Do NOT reapply its old web status-transaction file: that code now belongs to Equipment and includes stronger replay semantics. Do not recreate deleted Equipment SQL libraries in web.

Replace return-equipment-client.ts's SQL/in-process implementation with an HTTP adapter using the authenticated Equipment API and forwarded verified user identity. Map Equipment lab_id to the port's labId and component_name to name. Preserve changed/alreadyApplied semantics; compare API error code equipment_status_conflict rather than importing the Equipment error class into web/Loans. The branch's per-attempt random return key must be reconciled with a stable operation identity before network retries; account for expected-status fingerprints, immutable receipts, no-ops, stale replay results and uncertain commits. Review compensation separately; never blindly restore status after an ambiguous network failure. Its already-applied request_key migration is the same file now included here, not a duplicate migration to rerun.

## Verification and limits

- All 70 original Equipment tests moved with their implementation; route paths/auth invocation and options assertions were adapted. The original catalogue join assertion was explicitly changed and a new null-shape assertion added. No original behavior assertion was dropped.
- New tests cover token rejection on all 11 business method endpoints, permission denial, service/user identity separation, signed-lab query parameters, batch bounds/deduplication, availability/components, expected-status conflicts, key input mismatch, replay/no-op semantics and state rollback on history failure.
- Boundary tests scan production source for cross-owner SQL and web-to-Equipment implementation imports. Only test fixtures import both sides.
- Real local HTTP integration starts an isolated Equipment HTTP fixture dispatching actual route handlers and uses the actual web forwarders/signing/fetch helper. Only the web session/profile lookup and Equipment database are mocked. Tests verify identity spoofing cannot override signed actor/lab, catalogue shape, creation, status conflicts/replay, meaningful validation/duplicate errors, unavailable service and auth denial before HTTP.
- Actual Supabase login/profile-to-Equipment flows, live PostgreSQL locks/constraints/roles, real data mutations and deployment were intentionally NOT exercised. No SQL was executed against any database. This is Equipment extraction only; Users and Loans remain skeletons.

Remaining work: Users extraction (remove profile SQL/pg from web), Loans extraction and return/handover sagas/aggregation, restricted service roles/grants/RLS and optional cross-owner FK removal, deployment/provisioning, integration on real staged services, phone flows and professor demo evidence. No new infrastructure was added.

## Final executed checks

Type generation, all workspace tests, lint (no warnings), typecheck and all production builds passed. Final reviewed automated total: 314 tests across 28 files (web 88, shared auth 63, Equipment 143, Users skeleton 10, Loans skeleton 10). The original 70 Equipment tests are included in the Equipment count. The web build kept the existing route list; Equipment builds its new internal routes.

Started npm run dev:all on Windows: public health returned 200 for Users/Equipment/Loans; the existing web public page returned 200; all 11 actual Equipment business method endpoints returned 401 without tokens, before any database query. All child applications were then stopped. This did not use real authenticated domain requests or shared database data.

Final focused review: see handoff.md for modeled concurrent-request tests, sanitized schema/configuration errors and full limits. Missing schema is reported as 503/equipment_schema_not_ready; configuration/access/connection failures have fixed sanitized 503 messages. Recognized legacy-writer key uniqueness collisions roll back and return 409. No migration or real PostgreSQL/authenticated end-to-end workflow was run.
