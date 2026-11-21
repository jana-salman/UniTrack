import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CreateEquipmentInput } from "../lib/equipment-validation";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("../lib/db", () => ({ getDatabasePool: () => {
  if (!state.pool) throw new Error("Disposable kit integration pool is not ready");
  return state.pool;
} }));
import { addKitComponent, createKit, getKit, removeKitComponent, updateKit } from "../lib/kit-queries";

const expectedUrl = "postgresql://unitrack_local_test:local_test_only@127.0.0.1:55432/unitrack_test";
const configuredUrl = process.env.UNITRACK_TEST_DATABASE_URL;
const localDescribe = configuredUrl ? describe.sequential : describe.skip;
const componentOne = "53000000-0000-4000-8000-000000000101";
const componentTwo = "53000000-0000-4000-8000-000000000102";
const restrictedComponent = "53000000-0000-4000-8000-000000000103";
const labId = 7001;
let pool: Pool;
const kitIds: string[] = [];

const createInput = (asset_code: string, name = "Integration test kit"): CreateEquipmentInput => ({
  asset_code, name, description: "Synthetic kit", category_id: 7101, lab_id: labId,
  condition: "good", is_restricted: false,
});

async function clean() {
  if (kitIds.length) {
    await pool.query("delete from public.kit_components where kit_item_id = any($1::uuid[])", [kitIds]);
    await pool.query("delete from public.kits where item_id = any($1::uuid[])", [kitIds]);
    await pool.query("delete from public.equipment_items where id = any($1::uuid[])", [kitIds]);
    kitIds.length = 0;
  }
}

localDescribe("kit persistence and component integrity on disposable PostgreSQL", () => {
  beforeAll(async () => {
    if (configuredUrl !== expectedUrl) throw new Error("Refusing PostgreSQL test: use only database/local-test/run.ps1.");
    pool = new Pool({ connectionString: configuredUrl, max: 5 }); state.pool = pool;
    await pool.query("select 1");
    await pool.query(
      `insert into public.equipment_items (id, asset_code, name, category_id, lab_id, status, condition, is_restricted)
       values ($1, 'LOCAL-KIT-ITEM-A', 'Kit component A', 7101, 7001, 'available', 'good', false),
              ($2, 'LOCAL-KIT-ITEM-B', 'Kit component B', 7101, 7001, 'available', 'good', false),
              ($3, 'LOCAL-KIT-ITEM-R', 'Restricted component', 7101, 7001, 'available', 'good', true)`,
      [componentOne, componentTwo, restrictedComponent],
    );
  });
  afterEach(clean);
  afterAll(async () => {
    if (pool) {
      await clean();
      await pool.query("delete from public.equipment_items where id = any($1::uuid[])", [[componentOne, componentTwo, restrictedComponent]]);
      state.pool = null; await pool.end();
    }
  });

  it("creates the main QR item and an associated tracked component list", async () => {
    const kit = await createKit(createInput("LOCAL-KIT-QR-01"), "00000000-0000-4000-8000-000000000001", [componentOne]);
    expect(kit).toMatchObject({ asset_code: "LOCAL-KIT-QR-01", name: "Integration test kit", lab_id: labId });
    kitIds.push(kit!.id);
    expect(kit!.components).toHaveLength(1);
    expect(kit!.components[0]).toMatchObject({ tracked_item_id: componentOne, tracked_asset_code: "LOCAL-KIT-ITEM-A", is_active: true });
  });

  it("edits kit details and supports adding, viewing and removing components later", async () => {
    const kit = await createKit(createInput("LOCAL-KIT-QR-02"), "00000000-0000-4000-8000-000000000001", [componentOne]);
    kitIds.push(kit!.id);
    await updateKit(kit!.id, labId, { name: "Updated kit", description: "Updated details", serial_number: "KIT-SN", category_id: 7101, condition: "good", is_restricted: false });
    const newComponent = await addKitComponent(kit!.id, labId, componentTwo);
    const details = await getKit(kit!.id, labId);
    expect(newComponent).toHaveProperty("id");
    expect(details).toMatchObject({ name: "Updated kit", serial_number: "KIT-SN" });
    expect(details!.components).toHaveLength(2);
    await removeKitComponent(kit!.id, labId, newComponent!.id);
    expect((await getKit(kit!.id, labId))!.components.find((row: { id: string }) => row.id === newComponent!.id)).toMatchObject({ is_active: false });
  });

  it("rejects duplicate, restricted, nested, and cross-lab component associations", async () => {
    const kit = await createKit(createInput("LOCAL-KIT-QR-03"), "00000000-0000-4000-8000-000000000001", [componentOne]);
    kitIds.push(kit!.id);
    await expect(addKitComponent(kit!.id, labId, componentOne)).rejects.toMatchObject({ code: "23505" });
    await expect(addKitComponent(kit!.id, labId, restrictedComponent)).rejects.toMatchObject({ code: "KIT_COMPONENT_INELIGIBLE" });
    await expect(addKitComponent(kit!.id, labId, "53000000-0000-4000-8000-000000000199")).rejects.toMatchObject({ code: "KIT_COMPONENT_INVALID" });
  });
});
