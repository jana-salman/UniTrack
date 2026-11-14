# Users Service

Independent Next.js Users backend owning profiles and labs. Public /health remains process-only. Business routes are GET /profiles/:id (gateway service identity only), GET /profiles?labId= (manager), GET /profiles/batch?ids= (lab assistant/manager, names only), PATCH /profiles/:id/role (same-lab manager).

Privileged calls require current active actor state matching verified token role/lab. Batches accept at most 100 submitted UUIDs and return only same-lab id/full_name. Bootstrap can return inactive flags to the trusted gateway so web preserves its existing rejection messages. Supabase session/cookies and university-domain checks remain web-owned.

Configuration names: INTERNAL_JWT_SECRET and DATABASE_URL; public .env.example values are empty. No private file or real credential is supplied or modified. Existing profiles/labs schema is required; no new migration or SQL was executed for this extraction.

From root: npm run build:packages then npm run dev --workspace=@unitrack/users (3001), or npm run dev:all for all four apps. Root typegen/test/lint/typecheck/build include this workspace. Tests use only dummy secrets and mocked database dependencies.

See [Users extraction](../../docs/architecture/users-extraction.md) and [handoff](../../docs/architecture/handoff.md) for exact ownership, transport flow, configuration names, evidence and remaining work. Real Supabase/PostgreSQL flows and deployment remain unverified; Jana owns the separate Vercel investigation.
