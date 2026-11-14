import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../../../", import.meta.url));
function productionFiles(dir: string): string[] {
 return readdirSync(dir, { withFileTypes: true }).filter(e => !["node_modules", ".next", "tests"].includes(e.name)).flatMap(e => e.isDirectory() ? productionFiles(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts") ? [path.join(dir, e.name)] : []);
}
describe("Equipment data and import ownership", () => {
 it("Equipment SQL never queries another owner's tables", () => {
  for (const file of productionFiles(path.join(root, "services/equipment"))) {
   expect(readFileSync(file, "utf8"), file).not.toMatch(/\b(?:from|join|update|into)\s+(?:public\.)?(?:profiles|labs|reservations|loans|condition_records)\b/i);
  }
 });
 it("web has no Equipment SQL or imports of the Equipment implementation", () => {
  for (const file of productionFiles(path.join(root, "apps/web"))) {
   const source = readFileSync(file, "utf8");
   expect(source, file).not.toMatch(/\b(?:from|join|update|into)\s+(?:public\.)?(?:equipment_items|equipment_categories|kits|kit_components|equipment_status_history)\b/i);
   expect(source, file).not.toMatch(/services[\\/]equipment|@unitrack\/equipment/);
  }
 });
});
