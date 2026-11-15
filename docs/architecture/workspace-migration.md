# Baseline and workspace move

Date: 14 November 2026 (Asia/Beirut).
Reference: ../UniTrack-migration-reference/UniTrack_Microservices_Plan_v2 (1).docx, original architecture plan and accompanying JPEG, read locally. These files remain outside the repository.

## Provenance and scope
- Initial tree: clean on feature/C430PRJCT-41-return-equipment.
- Fetched origin; origin was verified to target jana-salman/UniTrack without printing its URL.
- Latest origin/main and baseline source: 001f952252229aa6172b7b59da5caf82a231c0b4.
- Created architecture/microservices from that origin/main commit. No pre-existing architecture branch or baseline tag existed.
- Local lightweight tag: monolith-baseline, pointing to that same commit.
- Preserved feature branch and remote-tracking tip: 3f220aa090d1774f112ba888cd509bfa408461b7.
- No merges, commits, pushes, deployments, main edits, migrations, seed/reset operations or shared database writes.
- No service extraction or new EquipmentClient abstraction in this task. The scope is baseline plus the workspace move only.

## Verification
| Check | Baseline | After move |
| --- | --- | --- |
| Next.js type generation | Pass | Pass via npm run typegen |
| npm test | 15 files, 107 tests passed | 15 files, 107 tests passed |
| npm run lint | Pass, exit 0 | Pass, exit 0 |
| npm run typecheck | Pass after stale generated cache preserved | Pass, exit 0 |
| npm run build | Pass after stale generated cache preserved | Pass, exit 0 |

The first baseline typecheck and build failed because ignored .next/dev/types/validator.ts still referenced the feature branch's return page and API. This failure was reported before moving application files. The generated .next/dev directory was preserved in a uniquely named system temporary directory, route types regenerated, and typecheck/build rerun successfully. No source or test changes were needed. The baseline tag was created only after all five checks passed. The old document's 107-test figure happens to match this actual baseline; it was not assumed.

Before and after builds produced the same route listing: /, /_not-found, /api/categories, /api/items, /api/items/[id], /api/items/[id]/status, /api/manager/equipment, /api/users/[id]/role, /catalogue, /dashboard, /login, /manager/categories, /manager/equipment, /manager/users, /scan and /unauthorized, with Proxy enabled. Both builds reported 15/15 static generation tasks. Return routes are absent because the feature branch has not been merged.

Root npm run dev and npm run start both started successfully; GET /unauthorized returned HTTP 200 on each. Both temporary servers were stopped. Compared 77 moved application/asset/test files against the baseline: no content differences. No existing locked dependency version changed. Private original/copy contents matched without displaying values; git check-ignore confirmed both and a nested environment path are ignored.

## Move and configuration
All tracked files below app/, components/, lib/, public/ and tests/ moved unchanged to apps/web/. App configs (ESLint, Next.js, TypeScript and both existing Vitest configs), proxy.ts and the placeholder .env.example moved with them. Both existing Vitest configs were retained unchanged; existing @ aliases still resolve relative to the web workspace. App dependencies and versions are unchanged in apps/web/package.json. Root scripts delegate to workspaces, and a single root lockfile describes @unitrack/web. Offline npm installation updated workspace metadata without lifecycle scripts.

Next.js tracing and Turbopack roots explicitly point to the repository root for hoisted dependency resolution. Existing Next.js feature flags and CSS loader rules remain unchanged. AGENTS.md stays at the repository root and applies to apps/web. Next.js dev also generated apps/web/AGENTS.md with the same bundled guidance; it is retained as advised by the existing rules. Database SQL and historical documentation remain at their existing root-relative paths. No browser paths, API shapes, source logic or assertions were changed.

The private root .env.local was preserved; a non-overwriting private copy at apps/web/.env.local was used for checks. Root ignore patterns cover environment files at every depth, allowing only .env.example placeholders. See README.md for variable names and Vercel settings.

## Return feature integration map (future work only)
The read-only comparison origin/main...feature/C430PRJCT-41-return-equipment contains 25 changed files, 2,682 insertions and 15 deletions. Do not merge or rewrite that branch as part of this task.

| Existing feature paths | First integration into workspace | Later service destination |
| --- | --- | --- |
| app/(protected)/return/[loanId]/{page.tsx,return-actions.tsx,return-details.tsx,return-form.tsx} | apps/web/app/(protected)/return/[loanId]/, preserving URLs | Remain web UI |
| app/api/returns/[loanId]/route.ts | apps/web/app/api/returns/[loanId]/route.ts | Browser route remains a gateway; domain handler goes to Loans |
| lib/returns/{checklist,inspection,queries,rules,save-records,service,transaction,types,validation}.ts | Same paths beneath apps/web/lib/returns/ | Loans service owns loan/reservation/condition-record logic and local transactions |
| lib/returns/equipment-port.ts | apps/web/lib/returns/equipment-port.ts | Port stays with Loans; shared transport DTOs may move to contracts |
| lib/clients/return-equipment-client.ts | apps/web/lib/clients/return-equipment-client.ts | Replace SQL/in-process adapter with authenticated Equipment HTTP adapter |
| lib/equipment-status-transaction.ts and its colocated test | Reconcile the feature's modifications into corresponding apps/web/lib files | Equipment service owns status transaction/history/idempotency |
| tests/return-{checklist,details-api,inspection,rules,service,validation}.test.ts | Same files under apps/web/tests/, preserving assertions | Domain tests move to Loans; Equipment tests to Equipment; gateway/API and UI contract checks remain at the appropriate boundary |
| database/migrations/C430PRJCT-41_status_request_key.sql | Keep database/migrations/ at root | Equipment-owned migration; retain applied-history provenance |

The Equipment adapter currently selects equipment_items and kit_components and calls updateEquipmentStatus in-process. That SQL belongs to Equipment after extraction; Loans must use its port over HTTP. Return GET currently assembles loan details plus equipment name/components; preserve its response shape when moving aggregation to the gateway. Return POST currently permits lab_assistant only, validates origin/lab/input, maps conflicts to 409 and reports uncertain commit outcomes as 503. Preserve these actual contracts pending an explicit later scope decision; v2's broader staff roles are not silently adopted.

The return implementation already supports expectedStatus, request-key deduplication and compensation. It restores the actual previous item status (including overdue), uses return:<loanId>:<randomUUID> and a matching :undo key, and avoids blind compensation after an uncertain database commit. V2 instead proposes stable return:<loanId>/return-undo:<loanId> keys and restoring checked_out. Before HTTP retries are introduced, explicitly reconcile durable operation identity, replay semantics, uncertain commit recovery, compensation conflicts and the network call held inside a locked Loans transaction. Do not replace these safeguards mechanically with the older pseudocode. Keep all existing feature tests and add meaningful cross-service retry/timeout tests at extraction time.

The request_key migration adds an optional text column plus a unique partial index for non-null keys. The user reports it is already applied to the shared development database. Do not rerun it, drop the column/index, create a duplicate migration, or seed/reset data. Its SQL remains solely on the feature branch in this change; reconcile migration history when that feature is integrated. Main's existing explicit-column SQL continues to work with the additional shared column; live schema state was not queried.

Future integration must be separately authorized and reviewed after the workspace move: relocate added paths and apply modified status files to their new locations, rather than recreating root app/lib/tests directories. Resolve overlap with other Sprint 2 work and rerun the combined suites. This task neither merges nor cherry-picks the feature.

## Remaining phases
1. Shared contracts/internal auth, service health skeletons and gateway call helper (v2 Phase 1 PRs 2/3).
2. Extract Equipment, keep status plus history atomic, add required service endpoints and reconcile existing feature idempotency.
3. Extract Users; replace web profile/database reads, retaining Supabase session handling. Remove pg and DATABASE_URL from web only then.
4. Integrate completed Sprint 2 work and extract Loans, with HTTP Equipment adapter, return/handover compensation and gateway aggregation.
5. Separate deployments and integration scenarios, request tracing and measured phone flows.
6. Service-specific roles/grants/RLS, ownership checks, consistency reporting and an explicit decision on optional cross-owner foreign keys.
7. Deployment/run documentation and demo evidence.

This intermediate layout still has one application, direct pg access and one deployment target. Independently running Users, Equipment and Loans do not exist yet. Authenticated browser workflows, real database operations and production Vercel behavior are outside this verification; database scripts were inspected but never executed.

## Pre-commit review
Rechecked moved files against HEAD: 84 files compared, with only the intended Next.js configuration changes. Both local environment files are ignored and untracked. Return branch and its remote-tracking ref remain at 3f220aa090d1774f112ba888cd509bfa408461b7. Removed incidental npm-generated extraneous metadata changes from six pre-existing optional bundled lockfile entries; existing dependency entries now match the baseline exactly. npm ci --dry-run --ignore-scripts --offline validates the workspace lockfile without reinstalling dependencies or running lifecycle scripts. README setup and Vercel paths match the workspace configuration; remote deployment remains unverified.
