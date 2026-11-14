# @unitrack/contracts

Shared TypeScript API types only: ApiError ({ error: string, code?: string }), HealthResponse ({ service, status, version }), existing profile role names, and the InternalIdentity union. No database access or domain logic.

UserIdentity has kind: "user", a nonempty subject, one of the existing profile roles, a positive safe-integer lab_id and a tracing rid. ServiceIdentity has kind: "service", sub: "gateway", role: "service", lab_id: null and rid. The gateway service identity has no user lab assignment; future consumers must explicitly allow service operations rather than treating it as a user.

The role names match apps/web/lib/auth/model.ts. The current app is unchanged and does not consume these packages yet. No equipment or loan payloads are introduced.

Run npm run build:packages from the root to produce ignored dist JavaScript/declarations. Package exports resolve compiled ESM and declarations; consumers import types from @unitrack/contracts. A clean checkout must build packages before direct use. Root test/typecheck/build commands do this automatically.
