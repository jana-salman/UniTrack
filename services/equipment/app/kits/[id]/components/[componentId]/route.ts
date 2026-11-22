import { requireRole } from "../../../../../lib/auth/authorization";
import { AuthorizationError } from "../../../../../lib/auth/errors";
import { equipmentFailure } from "../../../../../lib/service-errors";
import { removeKitComponent } from "../../../../../lib/kit-queries";
import { ITEM_ID } from "../../../../../lib/item-lookups";

type Context = { params: Promise<{ id: string; componentId: string }> };
export async function DELETE(request: Request, context: Context) {
  try {
    const manager = await requireRole(request, ["lab_manager"]);
    const { id, componentId } = await context.params;
    if (!ITEM_ID.test(id) || !ITEM_ID.test(componentId)) return Response.json({ error: "Invalid kit or component ID." }, { status: 400 });
    const component = await removeKitComponent(id, manager.lab_id, componentId);
    return component ? new Response(null, { status: 204 }) : Response.json({ error: "Active kit component not found." }, { status: 404 });
  } catch (error) {
    const unavailable = equipmentFailure(error);
    if (unavailable) return unavailable;
    if (error instanceof AuthorizationError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return Response.json({ error: "Could not remove this component.", code: "kit_unavailable" }, { status: 503 });
  }
}
