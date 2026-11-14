# UniTrack
University equipment borrowing and management system.

## Current layout
Users and Equipment business logic run in independent services behind the existing web APIs. Web keeps Supabase sessions and university-domain checks, bootstrapping profiles through Users HTTP; Loans now implements returns and privacy-safe catalogue due dates; reservation creation, handover and inspection resolution remain unbuilt. Web has no database driver or direct SQL. This is a partial migration, not completed microservices.
- apps/web: pages, API routes, components, libraries, tests, public assets and app configuration.
- services/equipment: authenticated Equipment backend and public /health.
- services/users: authenticated profile/role/name backend and public /health.
- services/loans: authenticated returns/due dates, Equipment HTTP Saga and public /health.
- database: shared SQL scripts, migrations and database documentation (paths unchanged).
- docs: project records and architecture notes.
- Root package.json and package-lock.json: workspace commands and one dependency lockfile.

## Local setup
1. Run npm ci from the repository root.
2. Create apps/web/.env.local from apps/web/.env.example without overwriting an existing local file. Obtain values privately for NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and ALLOWED_EMAIL_DOMAINS.
3. Configure the Equipment gateway/service names listed in docs/architecture/handoff.md through trusted server configuration, then run npm run dev:all. Do not inspect or overwrite existing private files for this handoff.

Next.js loads environment files from apps/web. The original root .env.local is preserved but is no longer the application's environment location. A private local copy was made for verification; neither file is tracked. Environment files are ignored at every depth except placeholder .env.example files. Never commit real values.

## Root commands
- npm run dev: existing web development server.
- npm run dev:all: build shared packages and start web/users/equipment/loans on 3000/3001/3002/3003; Ctrl+C stops all child processes.
- npm run typegen: generate Next.js route types before typecheck.
- npm test: all workspace tests.
- npm run lint: all workspace lint checks.
- npm run typecheck: all workspace TypeScript checks.
- npm run build: production build.
- npm run start: run the production build.

Application-specific commands also work through npm run <command> --workspace=@unitrack/web. Use npm run typegen instead of a bare npx next typegen at the repository root. Installed Next.js guides are in node_modules/next/dist/docs; read AGENTS.md before Next.js edits.

Database scripts stay at database/schema.sql, database/triggers.sql, database/seed.sql and database/migrations/. No npm command runs them automatically. Historical database verification instructions are in database/TESTING.md; they include writes and are not part of application verification. No scripts were executed against the database for this move.

## Vercel settings for this intermediate layout
Apply only when the workspace changes are reviewed and ready for deployment. Live settings have not been changed.
- Framework Preset: Next.js.
- Root Directory: apps/web.
- Include source files outside of the Root Directory in the Build Step: enabled (root lockfile and hoisted dependencies).
- Install Command override: cd ../.. && npm ci (runs at the repository root).
- Build Command override: cd ../.. && npm run build:packages && npm run build --workspace=@unitrack/web (build shared exports before web; commands start in apps/web).
- Output Directory: framework default (.next); do not set apps/web/.next relative to apps/web.
- Development Command: npm run dev.
- Retain the existing compatible Node.js version; do not change production branches or deployment settings as part of this task.
- Set DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and ALLOWED_EMAIL_DOMAINS in the appropriate Vercel environments, with values supplied privately.

Vercel documents per-app roots and the outside-root option at https://vercel.com/docs/monorepos and https://vercel.com/docs/monorepos/monorepo-faq. The equivalent local workspace build passed; remote install/build and deployed runtime have not been verified.

## Migration record
See [baseline, verification and return-branch integration map](docs/architecture/workspace-migration.md).

## Workflow
- Regular feature branch names: feature/C430PRJCT-XX-short-name.
- Architecture preparation is on architecture/microservices.
- Every change goes through a pull request with at least one review.

## Shared contracts and internal authentication

The compiled TypeScript workspaces [@unitrack/contracts](packages/contracts/README.md) and [@unitrack/internal-auth](packages/internal-auth/README.md) provide shared identity/API types, signed internal tokens and tracing IDs. Root npm test and npm run typecheck build the packages first; npm run build builds packages before the web app. npm run build:packages builds only shared packages. Root lint checks all workspaces. The web Equipment gateway and Equipment service consume them. INTERNAL_JWT_SECRET is supplied explicitly by server-side callers; production provisioning remains a later setup step. No private environment files need changes for this task.

## Service skeletons and gateway communication

See [service skeleton setup and verification](docs/architecture/service-skeletons.md). The new .env.example entries are empty placeholders only: INTERNAL_JWT_SECRET, USERS_SERVICE_URL, EQUIPMENT_SERVICE_URL and LOANS_SERVICE_URL for web calls; Users and Equipment also require DATABASE_URL. Loans requires DATABASE_URL, EQUIPMENT_SERVICE_URL and LOANS_DATABASE_SESSION_AFFINITY in addition to INTERNAL_JWT_SECRET; see the current handoff for its session-pooled/direct-connection requirement. Health/startup requires no secret. No private configuration was changed. Equipment routes now use the gateway helper; existing session/profile authentication remains unchanged. Current Vercel instructions above cover the web project only; separate service deployment/provisioning remains a later task.

## Equipment extraction

See [Equipment architecture, setup and return-branch handoff](docs/architecture/equipment-extraction.md). Existing browser APIs now use HTTP to Equipment; configure EQUIPMENT_SERVICE_URL and INTERNAL_JWT_SECRET for web, and DATABASE_URL and INTERNAL_JWT_SECRET for Equipment. Catalogue expectedReturn now uses Loans HTTP aggregation, with null dates and a notice when due dates are unavailable. Keyed status operations require the reviewed but unexecuted fingerprint migration; do not rerun the return branch request_key migration already applied to shared development. No private files, real credentials, live data or deployments were changed. Earlier skeleton records describe the preceding phase.

## Current handoff

[Migration handoff](docs/architecture/handoff.md) is the current entry point for exact commands, configuration names, migration order, verification limits, preserved return-branch integration and remaining work. Earlier phase records describe their state at that time.

## Users extraction

See [Users extraction record](docs/architecture/users-extraction.md) and the updated [handoff](docs/architecture/handoff.md). USERS_SERVICE_URL and INTERNAL_JWT_SECRET connect web to Users; Users owns DATABASE_URL. No private configuration was changed. Supabase session and university-domain checks remain web-side. Jana owns the separate Vercel investigation; older deployment notes above were not changed or validated by this task.

See [Loans return migration and recovery limitations](docs/architecture/loans-returns-extraction.md). The new return_operation migration remains unapplied; no SQL or live-data verification was performed. The preserved return branch was selectively ported, not merged.
