import { forwardEquipment } from "@/lib/gateway/equipment";
export async function PATCH(request: Request, context: RouteContext<"/api/items/[id]">) {
  const { id } = await context.params;
  return forwardEquipment(request, "/items/" + encodeURIComponent(id) + "");
}
