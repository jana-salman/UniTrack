import { expect, it } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../../../", import.meta.url));
function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).filter(e => ![".next", "node_modules", "tests"].includes(e.name)).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts") ? [path.join(dir, e.name)] : []); }
it("Users SQL accesses only Users-owned domain tables", () => {
 for (const file of files(path.join(root, "services/users"))) expect(readFileSync(file, "utf8"), file).not.toMatch(/\b(?:from|join|update|into)\s+(?:public\.)?(?:equipment_items|equipment_categories|equipment_status_history|kits|kit_components|reservations|loans|condition_records)\b/i);
});
it("web has no SQL/pg or imports of Users implementation", () => {
 for (const file of files(path.join(root, "apps/web"))) {
  const s = readFileSync(file, "utf8"); expect(s, file).not.toMatch(/\b(?:from|join|update|into)\s+(?:public\.)?(?:profiles|labs)\b/i);
  expect(s, file).not.toMatch(/(?:from\s+["']pg["']|lib\/db|services[\\/]users|@unitrack\/users)/);
 }
 const pkg = JSON.parse(readFileSync(path.join(root, "apps/web/package.json"), "utf8"));
 expect(pkg.dependencies.pg).toBeUndefined(); expect(pkg.devDependencies["@types/pg"]).toBeUndefined();
 expect(existsSync(path.join(root, "apps/web/lib/db.ts"))).toBe(false);
});
it("bootstrap transport does not depend on user authorization or read browser roles", () => {
 const source = readFileSync(path.join(root, "apps/web/lib/gateway/users-client.ts"), "utf8");
 expect(source).not.toMatch(/from ["'][^"']*(?:auth\/authorization|lib\/profiles)/);
 const profiles = readFileSync(path.join(root, "apps/web/lib/profiles.ts"), "utf8");
 expect(profiles).toContain('kind: "service"'); expect(profiles).not.toContain("getAuthenticatedProfile");
});
