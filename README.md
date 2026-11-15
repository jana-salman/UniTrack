# UniTrack
University equipment borrowing and management system.

## Current layout
The implemented UniTrack scope runs as four independently deployable Next.js applications. Web keeps Supabase sessions, university-domain checks, UI, and browser-facing gateway routes; Users owns profiles/roles/labs; Equipment owns catalogue/items/status history; Loans owns due dates and the return workflow and calls Equipment over authenticated HTTP. Web has no database driver or direct SQL. Reservation creation, handover, inspection resolution, notifications, and other unfinished product features are separate from the microservice extraction.
- apps/web: pages, API routes, components, libraries, tests, public assets and app configuration.
- services/equipment: authenticated Equipment backend and public /health.
- services/users: authenticated profile/role/name backend and public /health.
- services/loans: authenticated returns/due dates, Equipment HTTP Saga and public /health.
- database: shared SQL scripts, migrations and database documentation (paths unchanged).
- docs: project records and architecture notes.
- Root package.json and package-lock.json: workspace commands and one dependency lockfile.

## Local setup
1. Run npm ci from the repository root.
2. Create an untracked `.env.local` beside each application's `.env.example` without overwriting an existing file. Obtain real values privately; never copy them into documentation or source control.
3. Give Web all three service origins and the shared internal JWT secret. Give each backend its own `DATABASE_URL`; Loans also needs the Equipment origin and confirmed direct/session connection affinity.
4. Run npm run dev:all. Web, Users, Equipment, and Loans listen on ports 3000, 3001, 3002, and 3003. Public process checks are available at `/health` on every application.

Each Next.js application loads environment files from its own workspace directory. Environment files are ignored at every depth except placeholder `.env.example` files. Never commit real values. The disposable PostgreSQL workflow and its synthetic-only limits are documented in `database/local-test/README.md`.

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

## Vercel settings for the four applications

Apply these manually only after review; this repository task does not change Vercel. All projects use the Next.js preset, framework-default `.next` output, the same supported Node.js version, and **Include source files outside of the Root Directory** enabled. Commands are evaluated from the configured root directory.

| Project | Root directory | Install command | Build command |
| --- | --- | --- | --- |
| `unitrack-app` | `apps/web` | `cd ../.. && npm ci` | `cd ../.. && npm run build:packages && npm run build --workspace=@unitrack/web` |
| `unitrack-users` | `services/users` | `cd ../.. && npm ci` | `cd ../.. && npm run build:packages && npm run build --workspace=@unitrack/users` |
| `unitrack-equipment` | `services/equipment` | `cd ../.. && npm ci` | `cd ../.. && npm run build:packages && npm run build --workspace=@unitrack/equipment` |
| `unitrack-loans` | `services/loans` | `cd ../.. && npm ci` | `cd ../.. && npm run build:packages && npm run build --workspace=@unitrack/loans` |

Use the framework default Output Directory; do not enter a repository-relative `.next` path. Deploy all four from the same reviewed commit. `unitrack-app` must not remain on the older `architecture/microservices` branch while services use `architecture/loans-service` or later.

| Project | Required environment variables |
| --- | --- |
| Web | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ALLOWED_EMAIL_DOMAINS`, `INTERNAL_JWT_SECRET`, `USERS_SERVICE_URL`, `EQUIPMENT_SERVICE_URL`, `LOANS_SERVICE_URL` |
| Users | `INTERNAL_JWT_SECRET`, `DATABASE_URL` |
| Equipment | `INTERNAL_JWT_SECRET`, `DATABASE_URL` |
| Loans | `INTERNAL_JWT_SECRET`, `DATABASE_URL`, `EQUIPMENT_SERVICE_URL`, `LOANS_DATABASE_SESSION_AFFINITY=confirmed` |

The internal JWT secret must match in all four projects. Service URL values are the deployed HTTPS origins with no path, query, fragment, or embedded credentials. Web has no `DATABASE_URL`. Give each backend a separately provisioned login mapped to its service group role; do not use the database owner or Supabase `service_role`. Loans requires a direct or session-pooled URL, not a transaction-mode pooler.

The catalogue UI exists at `unitrack-app/catalogue`; `unitrack-equipment` is an authenticated API and is not a browser destination. A catalogue login redirect is expected when the Web deployment has no valid Supabase session. A redirect after signing in usually means the browser is on the wrong deployment/domain or Web has mismatched Supabase configuration; it is not fixed by making Equipment public.

## Migration record
See [baseline, verification and return-branch integration map](docs/architecture/workspace-migration.md).

## Workflow
- Regular feature branch names: feature/C430PRJCT-XX-short-name.
- Architecture preparation is on architecture/microservices.
- Every change goes through a pull request with at least one review.

## Shared contracts and internal authentication

The compiled TypeScript workspaces [@unitrack/contracts](packages/contracts/README.md) and [@unitrack/internal-auth](packages/internal-auth/README.md) provide shared identity/API types, signed internal tokens and tracing IDs. Root npm test and npm run typecheck build the packages first; npm run build builds packages before the web app. npm run build:packages builds only shared packages. Root lint checks all workspaces. The web Equipment gateway and Equipment service consume them. INTERNAL_JWT_SECRET is supplied explicitly by server-side callers; production provisioning remains a later setup step. No private environment files need changes for this task.

## Service skeletons and gateway communication

See [service skeleton setup and verification](docs/architecture/service-skeletons.md). The `.env.example` entries are empty placeholders only. Health/startup requires no secret. Equipment routes use the gateway helper; existing session/profile authentication remains unchanged. The Vercel table above covers all four independently deployed applications; provisioning those projects and their private values remains manual.

## Equipment extraction

See [Equipment architecture, setup and return-branch handoff](docs/architecture/equipment-extraction.md). Existing browser APIs now use HTTP to Equipment; configure EQUIPMENT_SERVICE_URL and INTERNAL_JWT_SECRET for web, and DATABASE_URL and INTERNAL_JWT_SECRET for Equipment. Catalogue expectedReturn now uses Loans HTTP aggregation, with null dates and a notice when due dates are unavailable. Keyed status operations require the reviewed but unexecuted fingerprint migration; do not rerun the return branch request_key migration already applied to shared development. No private files, real credentials, live data or deployments were changed. Earlier skeleton records describe the preceding phase.

## Current handoff

[Migration handoff](docs/architecture/handoff.md) is the current entry point for exact commands, configuration names, migration order, verification limits, preserved return-branch integration and remaining work. Earlier phase records describe their state at that time.

## Users extraction

See [Users extraction record](docs/architecture/users-extraction.md) and the updated [handoff](docs/architecture/handoff.md). USERS_SERVICE_URL and INTERNAL_JWT_SECRET connect web to Users; Users owns its DATABASE_URL. No private configuration was changed. Supabase session and university-domain checks remain web-side.

See [Loans return migration and recovery limitations](docs/architecture/loans-returns-extraction.md). Migrations 003-005 and service isolation 006 pass disposable PostgreSQL verification but remain unapplied to the shared Supabase database. The preserved return branch was selectively ported, not merged.
