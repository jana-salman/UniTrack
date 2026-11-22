import { forwardEquipment } from "@/lib/gateway/equipment";

type Context = { params: Promise<{ id: string }> };
async function path(context: Context) { return "/kits/" + encodeURIComponent((await context.params).id); }
export async function GET(request: Request, context: Context) {
  return forwardEquipment(request, await path(context));
}
export async function PATCH(request: Request, context: Context) {
  return forwardEquipment(request, await path(context));
}
