# Equipment Service

Independent authenticated Next.js Equipment backend. Owns equipment_categories, equipment_items, kits, kit_components and equipment_status_history. No Users/Loans table queries.

Public GET /health is configuration-free. Business routes require verified internal user tokens and role/lab authorization: catalogue, categories, manager list, create/edit/status, item/batch/availability/component lookup.

Configuration names: DATABASE_URL and INTERNAL_JWT_SECRET. The public .env.example contains empty placeholders only. No private configuration is provided or changed. Run npm run build:packages at root before independent dev/build; npm run dev --workspace=@unitrack/equipment uses port 3002. Root npm run dev:all starts all four apps; root checks include this workspace.

Keyed status requests also require manual database readiness: the already-applied-in-shared-dev request_key migration plus the new unexecuted request_fingerprint migration. No setup script runs SQL.

See [architecture and handoff](../../docs/architecture/equipment-extraction.md) for exact endpoints, safe replay/no-op semantics, schema requirements, manual setup, tests and unverified real-auth/database flows.
