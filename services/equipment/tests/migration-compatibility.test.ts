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
