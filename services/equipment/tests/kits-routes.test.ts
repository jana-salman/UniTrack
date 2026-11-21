import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), createKit: vi.fn(), listKits: vi.fn(), getKit: vi.fn(), updateKit: vi.fn(), addKitComponent: vi.fn(), removeKitComponent: vi.fn() }));
vi.mock("../lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("../lib/kit-queries", () => ({
  createKit: mocks.createKit, listKits: mocks.listKits, getKit: mocks.getKit, updateKit: mocks.updateKit,
  addKitComponent: mocks.addKitComponent, removeKitComponent: mocks.removeKitComponent,
}));

import { POST as create, GET as list } from "../app/kits/route";
import { GET as details, PATCH as edit } from "../app/kits/[id]/route";
import { POST as add } from "../app/kits/[id]/components/route";
import { DELETE as remove } from "../app/kits/[id]/components/[componentId]/route";
import { AuthorizationError } from "../lib/auth/errors";

const itemId = "11111111-1111-4111-8111-111111111111";
const componentId = "22222222-2222-4222-8222-222222222222";
const manager = { id: "manager-profile", role: "lab_manager", lab_id: 8 };
const context = (id = itemId, child = componentId) => ({ params: Promise.resolve({ id, componentId: child }) });
const req = (path: string, method: string, value?: unknown) => new Request("http://equipment.test" + path, { method, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue(manager);
  mocks.createKit.mockResolvedValue({ id: itemId, asset_code: "KIT-QR-01", lab_id: 8, components: [] });
  mocks.listKits.mockResolvedValue([]); mocks.getKit.mockResolvedValue({ id: itemId, components: [] });
  mocks.updateKit.mockResolvedValue({ id: itemId, name: "Edited kit", components: [] });
  mocks.addKitComponent.mockResolvedValue({ id: componentId }); mocks.removeKitComponent.mockResolvedValue({ id: componentId });
});

describe("kit management routes", () => {
  it("lists kits only after lab-manager authentication", async () => {
    const response = await list(req("/kits", "GET"));
    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith(expect.any(Request), ["lab_manager"]);
    expect(mocks.listKits).toHaveBeenCalledWith(manager.lab_id);
  });

  it("creates the main equipment item, QR asset code, and components in the manager's lab", async () => {
    const response = await create(req("/kits", "POST", { asset_code: "KIT-QR-01", name: "Sensor kit", category_id: 2, lab_id: 999, componentIds: [componentId] }));
    expect(response.status).toBe(201);
    expect(mocks.createKit).toHaveBeenCalledWith(expect.objectContaining({ asset_code: "KIT-QR-01", lab_id: 8 }), manager.id, [componentId]);
  });

  it("rejects duplicate or malformed component lists before database access", async () => {
    const response = await create(req("/kits", "POST", { asset_code: "KIT", name: "Kit", category_id: 2, componentIds: [componentId, componentId] }));
    expect(response.status).toBe(400);
    expect(mocks.createKit).not.toHaveBeenCalled();
  });

  it("retrieves and edits only a valid kit ID", async () => {
    expect((await details(req("/kits/" + itemId, "GET"), context())).status).toBe(200);
    expect(mocks.getKit).toHaveBeenCalledWith(itemId, manager.lab_id);
    const response = await edit(req("/kits/" + itemId, "PATCH", { name: "Edited kit", category_id: 2, condition: "good", is_restricted: false }), context());
    expect(response.status).toBe(200);
    expect(mocks.updateKit).toHaveBeenCalledWith(itemId, manager.lab_id, expect.objectContaining({ name: "Edited kit" }));
    expect((await details(req("/kits/invalid", "GET"), context("invalid"))).status).toBe(400);
  });

  it("supports later component additions and removals", async () => {
    const added = await add(req("/kits/" + itemId + "/components", "POST", { tracked_item_id: componentId }), context());
    expect(added.status).toBe(201);
    expect(mocks.addKitComponent).toHaveBeenCalledWith(itemId, manager.lab_id, componentId);
    const removed = await remove(req("/kits/" + itemId + "/components/" + componentId, "DELETE"), context());
    expect(removed.status).toBe(204);
    expect(mocks.removeKitComponent).toHaveBeenCalledWith(itemId, manager.lab_id, componentId);
  });

  it("enforces staff authorization and returns a useful duplicate conflict", async () => {
    mocks.requireRole.mockRejectedValueOnce(new AuthorizationError(403, "insufficient_role", "You do not have permission to perform this action."));
    expect((await create(req("/kits", "POST", { asset_code: "KIT", name: "Kit", category_id: 2, componentIds: [] }))).status).toBe(403);
    mocks.addKitComponent.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "23505" }));
    const duplicate = await add(req("/kits/" + itemId + "/components", "POST", { tracked_item_id: componentId }), context());
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).code).toBe("duplicate_component");
  });
});
