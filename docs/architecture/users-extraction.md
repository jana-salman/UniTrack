# Users extraction work record

Starting tree was clean. Fetch confirmed local architecture/microservices and origin/architecture/microservices both at a31bebd815eac20a49ea5f36ace0193cacd6cf5e (0 ahead/0 behind). No teammate changes needed reconciliation. Created architecture/users-service from that exact agreed baseline; no merge or overwrite. Return branch remains at 3f220aa090d1774f112ba888cd509bfa408461b7.

Pre-edit audit: apps/web/lib/profiles.ts contains all direct Users SQL (profile by ID, same-lab listing, same-lab role update). Its consumers are getAuthenticatedProfile in lib/auth/authorization.ts, app/login/actions.ts, the manager users page and /api/users/[id]/role. No direct labs queries or other database consumers remain outside lib/db.ts. Login/session/domain/email checks stay web-owned. Equipment and deployment configuration are out of scope.

## Implemented boundary

Users owns profiles and labs; only profiles queries were needed for the audited behavior. It has no Equipment, Loans, reservation or condition-record SQL. Existing same-lab profile lookup/list/update SQL moved into services/users/lib/profiles.ts. The original 7 role-handler tests moved with the implementation; existing login/auth/navigation tests remain web-side. No existing behavior test was removed.

| Internal endpoint | Identity and fields |
| --- | --- |
| GET /profiles/:id | Gateway service identity only; UUID validated; returns id/full_name/university_email/role/lab_id/is_active, or 404. Inactive flag remains visible only to bootstrap so web can reject with the existing inactive-account message. |
| GET /profiles?labId= | Active current lab_manager, signed lab equal to requested lab; full profile fields needed by manager UI, no other-lab rows. |
| GET /profiles/batch?ids= | lab_assistant/lab_manager only; at most 100 submitted UUIDs before deduplication, same-lab results, only id/full_name. Students/professors/service identities receive 403. |
| PATCH /profiles/:id/role | Active current same-lab manager; valid UUID/role body; SQL uses the manager's verified lab, never body actor/lab claims; retains { profile } success shape. Other-lab targets return 404 without mutation. |
| GET /health | Public process health only, no database or secret required. |

JWT verification uses the shared auth package. Missing/invalid/expired tokens fail 401, permissions 403. Privileged user calls re-read the Users-owned actor profile and reject inactive, moved-lab or changed-role identities rather than accepting stale privileged claims. No additional lab administration, user provisioning or Sprint 2 functionality was implemented.

## Web flow and dependency audit

getAuthenticatedProfile still verifies Supabase getUser, allowed email domain, matching provisioned email/profile and active flag. Its profile lookup is now HTTP through a restricted gateway service token. The transport module deliberately has no dependency on getAuthenticatedProfile, so bootstrap cannot recurse. Login uses the trusted signInWithPassword result; a mismatched returned email is rejected before profile lookup. Unknown/inactive users retain their existing failure/sign-out behavior.

After bootstrap, authenticated profile claims sign manager listing, role changes and unchanged Equipment calls. Manager SSR page uses HTTP with its already verified manager profile. Browser /api/users/:id/role is a thin forwarder; request headers/body cannot choose the internal actor. No browser URLs, UI components or role-update success shapes changed. React request-scoped caching remains; outbound service calls use no-store, so later requests refresh role/profile state. Already-issued Equipment tokens retain their existing short expiry behavior; Equipment itself was not edited.

apps/web/lib/profiles.ts is now a transport adapter, not a repository/SQL implementation. Unknown-account null is accepted only for the Users profile-not-found contract, not any upstream 404. Invalid/mismatched response profile data or missing Users configuration fails closed with a fixed unavailable error. Error bodies/codes pass the existing approved-vocabulary helper; SQL, tokens and credentials are not forwarded.

Auditing found no remaining web database consumers. Removed web lib/db.ts, pg, @types/pg and DATABASE_URL from tracked web manifest/template. PostgreSQL dependencies now belong to Users and Equipment, retaining existing locked versions. Private configuration files were not opened/read/copied/modified/displayed. No credentials, migrations or database records were provisioned.

## Configuration and setup

Web variable names: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, ALLOWED_EMAIL_DOMAINS, INTERNAL_JWT_SECRET, USERS_SERVICE_URL, EQUIPMENT_SERVICE_URL; LOANS_SERVICE_URL remains reserved for a later phase. Users variable names: INTERNAL_JWT_SECRET and DATABASE_URL, both empty placeholders in its public template. Equipment configuration is unchanged. A human must provide trusted runtime configuration later; nothing here changes private files or deployment settings.

No Users migration is introduced. Existing profiles/labs schema, RLS and connection-role readiness remain an owner's manual responsibility. Equipment migration status remains as recorded in the handoff; this task ran no SQL.

Startup/verification from root: npm ci, npm run dev:all; npm run typegen, npm test, npm run lint, npm run typecheck, npm run build. Shared packages build before tests/typechecking/startup. Ports remain web 3000, Users 3001, Equipment 3002, Loans 3003.

## Evidence and limits

New tests cover actual Users handlers with signed dummy tokens, role/lab restrictions, profile bootstrap identity restrictions, stale privileges, batch bounds/privacy and sanitized failures. Real localhost HTTP tests run actual web profile authorization/login logic, request signing/fetch and Users handlers; Supabase and PostgreSQL are isolated fixtures. They test non-university/unknown/inactive users, bootstrap without recursion, same-lab mutation, role refresh, name privacy, response validation and sanitized upstream failure. This is NOT real Supabase/PostgreSQL authenticated end-to-end evidence.

Equipment and Loans source and all deployment configuration are unchanged. No push, merge or deployment was performed. Jana's Vercel investigation remains separate; no deployment fix was added. Remaining work is Loans extraction/integration, database role/grant/RLS isolation, real staged auth/database/concurrency integration tests and separately owned deployment setup.

## Final verification

All workspace checks passed: type generation; 366 tests across 31 files (web 100, Users 50, Equipment 143, shared internal-auth 63, Loans skeleton 10); lint with no warnings; typecheck; all package/app builds. The original 314-test coverage remains included.

Started dev:all on Windows: health on Users/Equipment/Loans returned HTTP 200; all four actual Users business endpoints rejected unsigned requests with 401 before any database query; existing web public page returned 200. All apps were stopped and local listener shutdown checked. Actual logged-in Supabase/cookie/profile/database flows, real PostgreSQL schema/roles and deployment remain unverified. HTTP fixture tests use actual transport and handlers but mocked Supabase/PostgreSQL.

## Users focused review

Verified Supabase-first bootstrap, restricted service/user identities, fresh profile-derived claims, active/known/university account checks, role/lab/privacy enforcement, production SQL/import boundaries and unchanged Equipment/return-branch source. React cache is request-scoped, not a persistent profile/privilege cache; outbound fetch uses no-store. Users revalidates current actor role/lab/active state; existing Equipment JWT lifetime behavior remains unchanged.

Fixed a malformed-body ordering regression: the web role gateway now sends null input to Users for validation after authorization, so a student remains forbidden (403) even with malformed JSON, while an authorized manager receives 400. A real local HTTP fixture regression covers both and confirms no UPDATE. All HTTP tests use isolated Supabase/PostgreSQL fixtures, not real logged-in/database end-to-end verification. Deployment settings and private environment files remain untouched.
