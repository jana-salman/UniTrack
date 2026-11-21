import { forwardEquipment } from "@/lib/gateway/equipment";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return forwardEquipment(request, "/kits/" + encodeURIComponent(id) + "/components");
}
