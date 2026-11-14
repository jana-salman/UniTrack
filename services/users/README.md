# users service skeleton

Independent Next.js application exposing only public GET /health with service, status and package version. No SQL, domain routes or downstream calls exist. Health remains available without configuration and reveals no configuration values.

From the repository root, run npm install, then npm run build:packages. Run npm run dev --workspace=@unitrack/users for this app alone, or npm run dev:all for all four apps. Its fixed development/start port is 3001. Build with npm run build --workspace=@unitrack/users; npm run start --workspace=@unitrack/users serves that build on the same port.

.env.example contains only INTERNAL_JWT_SECRET with an empty value. No database credentials are needed. Future protected handlers must supply this value from trusted server configuration at request time; missing/invalid token verification fails closed with 401. No private environment file was created or changed for this task, and no production secret has been provisioned.

lib/auth.ts exports withInternalAuth(handler, { secret, roles }). Permission checks explicitly allow profile roles or service; an authenticated identity without an allowed role receives 403. User lab authorization remains the responsibility of future domain handlers. A service identity is not automatically allowed as a user. X-Request-Id is not an identity source.

Tests invoke an actual protected GET handler in tests/fixtures/protected-route.ts, outside the app directory. That fixture uses only public dummy test credentials and is never a production endpoint. Run npm test from the root to build shared dependencies and run all suites. Unit tests make no network or database calls. See docs/architecture/service-skeletons.md at the repository root for integration scope and verification.
