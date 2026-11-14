# UniTrack
University equipment borrowing and management system.

## Current layout
This is one Next.js application in an npm workspace, not completed microservices.
- apps/web: pages, API routes, components, libraries, tests, public assets and app configuration.
- database: shared SQL scripts, migrations and database documentation (paths unchanged).
- docs: project records and architecture notes.
- Root package.json and package-lock.json: workspace commands and one dependency lockfile.

## Local setup
1. Run npm ci from the repository root.
2. Create apps/web/.env.local from apps/web/.env.example without overwriting an existing local file. Obtain values privately for DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and ALLOWED_EMAIL_DOMAINS.
3. Run npm run dev from the root; open http://localhost:3000.

Next.js loads environment files from apps/web. The original root .env.local is preserved but is no longer the application's environment location. A private local copy was made for verification; neither file is tracked. Environment files are ignored at every depth except placeholder .env.example files. Never commit real values.

## Root commands
- npm run dev: web development server.
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
- Build Command override: npm run build (runs in apps/web).
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

The compiled TypeScript workspaces [@unitrack/contracts](packages/contracts/README.md) and [@unitrack/internal-auth](packages/internal-auth/README.md) provide shared identity/API types, signed internal tokens and tracing IDs. Root npm test and npm run typecheck build the packages first; npm run build builds packages before the web app. npm run build:packages builds only shared packages. Root lint checks all workspaces. The current web application does not use them yet. INTERNAL_JWT_SECRET must be supplied explicitly by future server-side callers; production provisioning remains a later setup step. No private environment files need changes for this task.
