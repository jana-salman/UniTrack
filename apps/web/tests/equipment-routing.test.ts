import { beforeEach, expect, it, vi } from "vitest";
const { forward, aggregate } = vi.hoisted(() => ({ forward: vi.fn(), aggregate: vi.fn() }));
vi.mock("@/lib/gateway/catalogue", () => ({ catalogue: aggregate }));
vi.mock("@/lib/gateway/equipment", () => ({ forwardEquipment: forward }));
import { GET as catalogue, POST as create } from "@/app/api/items/route";
import { GET as categories, POST as addCategory } from "@/app/api/categories/route";
import { GET as manager } from "@/app/api/manager/equipment/route";
import { PATCH as edit } from "@/app/api/items/[id]/route";
import { PATCH as status } from "@/app/api/items/[id]/status/route";
beforeEach(() => { forward.mockReset().mockResolvedValue(Response.json({ result: "ok" })); aggregate.mockReset().mockResolvedValue(Response.json([])); });
it("routes catalogue through read-only aggregation", async () => { const req = new Request("http://web.test/api/items?q=one"); expect((await catalogue(req)).status).toBe(200); expect(aggregate).toHaveBeenCalledExactlyOnceWith(req); });
it.each([
 [create, "POST", "/items"],
 [categories, "GET", "/categories?q=one"], [addCategory, "POST", "/categories"],
 [manager, "GET", "/manager/equipment?q=one"],
] as const)("forwards the original request to the matching static service path", async (handler, method, path) => {
 const request = new Request("http://web.test/api/anything?q=one", { method });
 const response = await handler(request); expect(response.status).toBe(200);
 expect(forward).toHaveBeenCalledExactlyOnceWith(request, path);
});
it("preserves dynamic browser paths and encodes IDs", async () => {
 const request = new Request("http://web.test/api/items/one", { method: "PATCH" });
 const context = { params: Promise.resolve({ id: "one/two" }) };
 await edit(request, context); expect(forward).toHaveBeenLastCalledWith(request, "/items/one%2Ftwo");
 await status(request, context); expect(forward).toHaveBeenLastCalledWith(request, "/items/one%2Ftwo/status");
});
