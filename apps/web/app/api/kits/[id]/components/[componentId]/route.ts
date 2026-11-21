import { forwardEquipment } from "@/lib/gateway/equipment";

type Context = { params: Promise<{ id: string; componentId: string }> };
export async function DELETE(request: Request, context: Context) {
  const { id, componentId } = await context.params;
  return forwardEquipment(request, "/kits/" + encodeURIComponent(id) + "/components/" + encodeURIComponent(componentId));
}
