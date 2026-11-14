# Service skeletons and gateway helper

Scope: v2 Phase 1 PR 3 only, on architecture/microservices after fba34e671522ed22e16a8712a277ac9f7fa4f1ff. No domain extraction, new web endpoints, database changes or live deployment.

## Local applications

| App | Workspace | Port | Public check |
| --- | --- | --- | --- |
| Existing web | @unitrack/web | 3000 | Existing /unauthorized page |
| Users | @unitrack/users | 3001 | /health |
| Equipment | @unitrack/equipment | 3002 | /health |
| Loans | @unitrack/loans | 3003 | /health |

Run npm install at the root, then npm run dev:all. Its pre-hook builds shared exports. Each application runs as a distinct Next.js process; service scripts also support independent dev/build/start. Health returns { service, status: "ok", version } using the package version. It does not query a database, call another service, load credentials or return configuration.

concurrently 9.2.5 (compatible with Node 20 as well as the tested Node 24.18.0) is the only newly introduced external dependency; it is a development process runner, not deployment infrastructure. The dev:all script uses double-quoted commands for Windows cmd compatibility and --kill-others to terminate sibling process trees when one command exits. Ctrl+C stops the group. Existing locked dependency versions remain unchanged. Root typegen/test/lint/typecheck/build include all applications and shared packages; shared dependencies build before tests/typechecking/app builds. Build currently invokes the shared package build again during the workspace traversal; this is harmless and keeps the command inclusive.

## Configuration names (no values provisioned)

- Each service: INTERNAL_JWT_SECRET, documented with an empty .env.example placeholder.
- Future gateway callers: INTERNAL_JWT_SECRET plus USERS_SERVICE_URL, EQUIPMENT_SERVICE_URL and LOANS_SERVICE_URL; empty placeholders added to apps/web/.env.example.
- Future local service URL configuration points to http://localhost:3001, http://localhost:3002 and http://localhost:3003 respectively. URLs must be service origins with no username/password, path prefix, query or fragment.

Health and startup work without secrets. Future protected handlers require explicitly supplied trusted server configuration. Missing secrets fail closed. Production provisioning remains a later setup step; no credentials or private environment files were created, opened, copied, modified or displayed in this task. Existing web configuration was loaded automatically by Next.js checks only.

## Authentication boundary

Each service has lib/auth.ts, using @unitrack/internal-auth for verified HS256 identity. withInternalAuth wraps a Request-to-Response handler with explicit allowed roles and caller-supplied secret. Missing/malformed/expired/wrong-signature tokens return sanitized 401. Verified identities without a permitted role return 403. A gateway service identity cannot pass a user role check. Signed identity data is passed to the handler; browser role/profile/lab headers and tracing headers are not trusted as authorization. Domain lab checks remain future domain code's responsibility.

Only /health is installed in the production route tree. Tests exercise a protected GET export in tests/fixtures/protected-route.ts; it is not an app route. There are no artificial production business endpoints.

## Gateway helper

apps/web/lib/gateway/call-service.ts is server-only. createServiceCaller({ baseUrl, secret }) must be instantiated using trusted server configuration, never request/browser-supplied destinations. The returned callService(path, identity, { method, body }) accepts only paths on that configured origin. Absolute/protocol-relative destinations, credentials, fragments and redirect following are rejected. Its explicit identity must come from the existing server-side session and authenticated profile; caller input is not evidence that a user is authenticated. Current web session/profile flow is untouched and no route uses this helper yet.

The helper signs the identity using the shared package and sends Authorization, X-Request-Id and Content-Type. An abort deadline of five seconds covers fetch and successful JSON body consumption. It never retries, including mutations. It omits browser cookies, disables cache and redirects, and does not accept pass-through browser headers.

Successful JSON bodies/statuses are preserved (also supports HEAD and 204). Expected upstream HTTP status codes are retained, with safe fixed error messages and upstream_<status> codes; arbitrary upstream error bodies and headers are deliberately not relayed. Connection failures map to 502/service_unavailable, timeout to 504/service_timeout, malformed or unexpected upstream responses to 502/service_response, and invalid trusted configuration/identity to 500/service_configuration. No helper logs tokens, secrets, URLs or response bodies.

## Verification

- npm run typegen passed for web and all three services.
- npm test passed: 234 tests / 20 files (107 existing web, 34 gateway, 63 shared auth, and 10 per service).
- npm run lint and npm run typecheck passed across all workspaces.
- npm run build passed: existing web routes unchanged, both shared packages build, each service builds only /health plus Next.js default not-found handling.
- npm run dev:all started all four apps on their assigned ports on Windows. Public service /health responses were HTTP 200 with the expected exact JSON; existing web /unauthorized returned HTTP 200.
- After stopping dev:all, TCP connection attempts confirmed ports 3000-3003 were all closed. Startup/health and shutdown checks were repeated after selecting the compatible runner release.
- Protected fixture GET tests, service lint and typechecks were repeated after making the fixture GET export explicit.
- Authentication tests cover missing/invalid/expired/wrong-signature tokens, missing secrets, role rejection, service/user separation and no sensitive response/log data. Gateway tests cover signed trusted claims (even when body includes conflicting browser claims), headers, destination restrictions, five-second timeout including body read, connection failure, mutation no-retry, expected HTTP errors, redirect/HTML rejection, empty success and privacy.

The only real HTTP smoke checks were unauthenticated public routes. Protected authentication is verified through actual route-handler fixtures, not deployed routes; no service-to-service production exchange exists yet. No authenticated domain flows, live database operations, deployments or production secret setup were attempted. Root install still reports the 10 previously noted tooling advisories (8 moderate, 2 critical); unrelated upgrades are out of scope.

The separate return branch remains at 3f220aa090d1774f112ba888cd509bfa408461b7. No pushes, merges or deployments were performed for this task. These are running skeletons, not completed microservices.

## Review before commit
Fixed two gateway response-handling gaps: a successful upstream JSON echo of the outgoing internal token or signing secret now returns a sanitized 502, and the request is aborted in finally to release unread upstream bodies. Added credential-echo and stream-cleanup regression tests. A real local HTTP fixture sends headers and a partial body, then stalls: the helper returned sanitized 504 after five seconds. The helper is server-only and accepts explicit trusted server configuration/identity; it has no browser-facing entry point and does not authenticate a caller by merely accepting typed claims. Future callers must obtain identities from existing verified session/profile authentication. No existing web route or authentication behavior was changed.

Startup-failure cleanup was exercised on Windows by intentionally occupying port 3001 with an isolated credential-free TCP fixture. Users failed with EADDRINUSE; dev:all exited nonzero and killed web/equipment/loans. TCP checks confirmed only the deliberate blocker remained, which was then stopped. The earlier successful four-app smoke test and normal shutdown also passed. No private environment files were opened, copied, modified or displayed.
