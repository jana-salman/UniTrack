# Equipment Service

Independent authenticated Next.js Equipment backend. Owns equipment_categories, equipment_items, kits, kit_components and equipment_status_history. No Users/Loans table queries. Lab managers create QR-coded kits from a main equipment item and manage same-lab tracked components through `/kits`; student reservation resource checks receive a narrow component-status response through `/items/[id]/reservation-components`.

Public GET /health is configuration-free. Business routes require verified internal user tokens and role/lab authorization: catalogue, categories, manager list, create/edit/status, item/batch/availability/component lookup, and staff-only kit management.

Configuration names: DATABASE_URL and INTERNAL_JWT_SECRET. The public .env.example contains empty placeholders only. No private configuration is provided or changed. Run npm run build:packages at root before independent dev/build; npm run dev --workspace=@unitrack/equipment uses port 3002. Root npm run dev:all starts all four apps; root checks include this workspace.

Kit mutation also requires S2-05 after 006, S2-02, S2-09 and 007. It preserves
the existing `kits`/`kit_components` model, validates same-lab membership,
prevents duplicate tracked components, and synchronizes active kit reservations
with their tracked items. The disposable local database runner verifies this
migration; it is never applied automatically.

Keyed status requests require the request-key prerequisite plus migrations 003
and 005. The database owner reports these migrations applied and postflight
verified on shared Supabase. No application startup or npm command runs SQL.

See [architecture and handoff](../../docs/architecture/equipment-extraction.md) for exact endpoints, safe replay/no-op semantics, schema requirements, manual setup, tests and unverified real-auth/database flows.
