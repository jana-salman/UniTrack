# Shared contracts and internal authentication

Implemented on architecture/microservices after workspace commit 487e717671dfff3054d2be136e49745d322c4ce3. Scope is v2 Phase 1 PR 2 only: contracts and internal-auth packages. No service skeletons, gateway routes, app behavior changes or database operations.

## Contracts and choices

See packages/contracts/README.md and packages/internal-auth/README.md for APIs. Roles mirror the current application's profile roles. Contracts intentionally omit speculative equipment/loan DTOs. Shared health response carries service, status and version strings; error response is { error: string, code?: string }.

User identities require a positive safe integer lab ID and a nonempty subject other than gateway. Service identities explicitly use gateway/service/null; they do not inherit user privileges. The kind discriminator is derived from verified claims. Tokens use HS256 only, issuer unitrack-gateway, required iat/exp and exact 60-second lifetime. Missing/empty secrets are rejected. Every failure is sanitized; no unverified decode path, credentials, environment reads or logging exists in the implementation. INTERNAL_JWT_SECRET is supplied by future callers; production provisioning remains deferred.

Request IDs are bounded and header-safe. They are tracing labels, not authorization or idempotency keys. Invalid IDs are replaced with UUIDs, while invalid token rid claims are rejected.

## Workspace integration

Root workspaces include apps/* and packages/*. Contracts build before internal-auth; root pretest/pretypecheck hooks build packages for clean checkout exports. Root build builds packages before web; lint traverses all workspaces. Packages export compiled ESM and declarations, with ignored dist outputs. Existing web source/config/tests and return branch remain unchanged. No private environment files were opened, copied, changed or displayed.

## Verification

- Type generation: passed using npm run typegen.
- Existing web suite: 15 files / 107 tests passed, unchanged.
- Auth suite: 63 tests passed, using dummy secrets only; includes public package-export consumption. Total: 170 tests across 16 files.
- Lint, TypeScript checks and production build: passed across the workspaces. Affected auth lint/typecheck/build were repeated after tightening request-ID checks for trailing line terminators.
- Package-lock existing dependency versions and entries: unchanged. jose 6.2.17 added with two local workspace links.
- Build and app routes remain unchanged. Package build outputs and private environment paths are ignored.
- npm audit reports 10 advisories (8 moderate, 2 critical) in the existing Vitest/tinypool and TypeScript ESLint/minimatch dependency chains. These dependencies were already in the baseline lockfile; no existing versions were upgraded. Dependency remediation is outside this change.

No actual service HTTP exchange, deployment or database behavior was tested: consumers do not exist yet. These libraries do not make the application independently deployed microservices. Changes are left uncommitted for review; no credentials were generated or provisioned.

## Security review
Verified signature-before-identity handling, HS256 allowlist, issuer/expiry/lifetime checks, typed role/lab/subject/request claims, explicit gateway service identities, and required caller-supplied secrets. No implementation logging, unverified decoding or secret fallback exists. Added a focused privacy regression test asserting sanitized errors without nested causes or token/secret material and no console logging. No security defects required implementation changes. Existing web files, database files, return branch and pre-existing dependency versions remain unchanged.
