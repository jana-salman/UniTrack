import { expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
function production(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).filter(e => !["tests", "node_modules", ".next"].includes(e.name)).flatMap(e => e.isDirectory() ? production(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts") ? [path.join(dir, e.name)] : []);
}
it("Loans SQL accesses only owned tables and imports no web/Users/Equipment implementation", () => {
  for (const file of production(path.join(root, "services/loans"))) {
    const source = readFileSync(file, "utf8");
    // SQL targets are always explicitly public-qualified in the implementation.
    for (const match of source.matchAll(/\b(?:from|join|update|into)\s+public\.([a-z_]+)/gi)) expect(["reservations", "reservation_resources", "loans", "condition_records"]).toContain(match[1]);
    expect(source).not.toMatch(/\b(?:from|join|update|into)\s+(?:public\.)?(?:profiles|labs|equipment_items|equipment_categories|kits|kit_components|equipment_status_history)\b/i);
    expect(source).not.toMatch(/(?:services[\\/](?:equipment|users)|apps[\\/]web|@unitrack\/(?:equipment|users|web))/);
    expect(source).not.toMatch(/console\.(?:log|error|warn)/);
  }
});
it("web contains no direct SQL/pg or service implementation imports", () => {
  for (const file of production(path.join(root, "apps/web"))) {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/(?:services[\\/](?:loans|equipment|users)|@unitrack\/(?:loans|equipment|users))/);
    expect(source).not.toMatch(/\b(?:from|join|update|into)\s+public\./i);
    expect(source).not.toMatch(/from\s+["']pg["']|DATABASE_URL/);
  }
});
it("Loans migration is additive for existing rows and never rewrites immutable audit data", () => {
  const migration = readFileSync(path.join(root, "database/migrations/004_loans_return_operation.sql"), "utf8").replace(/--[^\n]*/g, "");
  expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS return_operation JSONB/i);
  expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|DROP|TRUNCATE|DISABLE|NOT NULL|DEFAULT)\b/i);
  const existing = readFileSync(path.join(root, "database/migrations/C430PRJCT-41_status_request_key.sql"), "utf8");
  expect(existing).toMatch(/ADD COLUMN IF NOT EXISTS request_key/i);
});
