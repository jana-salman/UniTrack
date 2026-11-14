import { forwardEquipment } from "@/lib/gateway/equipment";
export async function PATCH(request: Request, context: RouteContext<"/api/items/[id]/status">) {
  const { id } = await context.params;
  return forwardEquipment(request, "/items/" + encodeURIComponent(id) + "/status");
}
