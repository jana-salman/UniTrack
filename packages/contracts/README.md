# @unitrack/contracts

Shared TypeScript wire types and pure runtime validators for identity, profiles,
Equipment catalogue/item/status responses, Loans due dates, return details and
return outcomes. The package has no database, HTTP, framework or persistence
dependency.

UserIdentity has kind: "user", a nonempty subject, one of the existing profile roles, a positive safe-integer lab_id and a tracing rid. ServiceIdentity has kind: "service", sub: "gateway", role: "service", lab_id: null and rid. The gateway service identity has no user lab assignment; future consumers must explicitly allow service operations rather than treating it as a user.

Web and all three services consume these contracts. Runtime validators are used
at cross-service and browser boundaries so a successful but incompatible JSON
payload fails closed instead of being cast to an expected shape. Business rules
and database-row validation remain owned by the relevant service.

Run npm run build:packages from the root to produce ignored dist JavaScript/declarations. Package exports resolve compiled ESM and declarations; consumers import types from @unitrack/contracts. A clean checkout must build packages before direct use. Root test/typecheck/build commands do this automatically.
