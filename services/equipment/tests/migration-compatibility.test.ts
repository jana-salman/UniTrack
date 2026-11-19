import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
const migrations = new URL("../../../database/migrations/", import.meta.url);
it("request-key migration leaves existing columns/rows and immutable triggers intact", () => {
 const sql = readFileSync(new URL("C430PRJCT-41_status_request_key.sql", migrations), "utf8");
 expect(sql).toMatch(/add column if not exists request_key text/i);
 expect(sql).toMatch(/create unique index if not exists[\s\S]*where request_key is not null/i);
 expect(sql).not.toMatch(/\b(?:update|delete|truncate|drop)\s|disable\s+trigger|set\s+not\s+null/i);
});
it("fingerprint migration is additive/nullable and does not backfill immutable history", () => {
 const sql = readFileSync(new URL("003_equipment_request_fingerprint.sql", migrations), "utf8");
 expect(sql).toMatch(/add column if not exists request_fingerprint text/i);
 expect(sql).not.toMatch(/\b(?:update|delete|truncate|drop)\s|disable\s+trigger|not\s+null|default\s/i);
});
it("operation ownership migration adds nullable state and preserves immutable audit rows", () => {
 const sql = readFileSync(new URL("005_equipment_operation_guard.sql", migrations), "utf8").replace(/--[^\n]*/g, "");
 expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS status_request_key text/i);
 expect(sql).toMatch(/BEFORE UPDATE OF status ON public\.equipment_items/i);
 expect(sql).toMatch(/NEW\.status_request_key := NULL/i);
 expect(sql).toMatch(/AFTER INSERT ON public\.equipment_status_history/i);
 expect(sql).toMatch(/UPDATE public\.equipment_items[\s\S]*NEW\.request_key/i);
 expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM|ALTER TABLE)\s+public\.equipment_status_history|DISABLE\s+TRIGGER|\b(?:DROP|TRUNCATE)\b/i);
 expect(sql).not.toMatch(/status_request_key text\s+(?:NOT NULL|DEFAULT)/i);
});

it("keeps the 003-005 preflight read-only and checks the required gates", () => {
 const sql = readFileSync(new URL("../verification/preflight_003_005.sql", migrations), "utf8");
 const executable = sql
  .replace(/--[^\n]*/g, "")
  .replace(/'(?:''|[^'])*'/g, "''");

 expect(executable.trim()).toMatch(/^WITH\b/i);
 expect(executable.match(/;/g)).toHaveLength(1);
 expect(executable).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO|COPY|LOCK)\b/i);
 expect(executable).not.toMatch(/\bnextval\s*\(|pg_(?:try_)?advisory_lock|FOR\s+(?:UPDATE|SHARE)\b/i);
 expect(sql).toContain("equipment_status_history_request_key_unique");
 expect(sql).toContain("loans_one_active_per_item");
 expect(sql).toContain("no_005_function_name_conflicts");
 expect(sql).toContain("no_005_trigger_name_conflicts");
 expect(sql).toContain("public_has_no_table_write_grants");
 expect(sql).toContain("'00_OVERALL_' || gate || '_GATE'");
});

it("keeps service isolation password-free and scoped to explicit UniTrack objects", () => {
 const sql = readFileSync(new URL("006_service_database_isolation.sql", migrations), "utf8");
 const executable = sql.replace(/--[^\n]*/g, "");

 expect(executable).toMatch(/CREATE ROLE %I NOLOGIN[\s\S]*NOBYPASSRLS/i);
 expect(executable).not.toMatch(/\bPASSWORD\b|ALL TABLES IN SCHEMA|ALL SEQUENCES IN SCHEMA/i);
 expect(executable).toMatch(/pg_auth_members[\s\S]*service group role inherits another role/i);
 expect(executable).toMatch(/REVOKE ALL PRIVILEGES ON SCHEMA public FROM[\s\S]*unitrack_loans_service/i);
 expect(executable).toMatch(/REVOKE CREATE ON SCHEMA public FROM PUBLIC/i);
 expect(executable).toMatch(/REVOKE ALL PRIVILEGES ON TABLE[\s\S]*FROM[\s\S]*unitrack_users_service[\s\S]*unitrack_equipment_service[\s\S]*unitrack_loans_service/i);
 expect(executable).toContain("public.equipment_status_history");
 expect(executable).toContain("public.equipment_status_history_id_seq");
 expect(executable).toMatch(/GRANT SELECT ON public\.labs TO unitrack_users_service/i);
 expect(executable).toMatch(/GRANT SELECT, UPDATE ON public\.loans TO unitrack_loans_service/i);
 expect(executable).toMatch(/GRANT SELECT, INSERT ON public\.equipment_status_history TO unitrack_equipment_service/i);
});

it("prevents overlapping confirmed reservations with an additive exclusion constraint", () => {
  const sql = readFileSync(
    new URL("S2-02_no_double_booking.sql", migrations),
    "utf8",
  ).replace(/--[^\n]*/g, "");

  expect(sql).toMatch(/BEGIN\s*;/i);
  expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS btree_gist/i);
  expect(sql).toMatch(
    /ADD CONSTRAINT reservations_no_overlapping_confirmed\s+EXCLUDE USING gist/i,
  );
  expect(sql).toContain("item_id WITH =");
  expect(sql).toContain("tstzrange(start_at, end_at, '[)')");
  expect(sql).toMatch(/WHERE\s*\(\s*status\s*=\s*'confirmed'\s*\)/i);
  expect(sql).toMatch(/COMMIT\s*;/i);

  expect(sql).not.toMatch(
    /\b(?:UPDATE|DELETE|TRUNCATE|DROP)\b|DISABLE\s+TRIGGER/i,
  );
});
