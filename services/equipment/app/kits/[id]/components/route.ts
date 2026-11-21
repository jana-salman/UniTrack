import { requireRole } from "../../../../lib/auth/authorization";
import { AuthorizationError } from "../../../../lib/auth/errors";
import { equipmentFailure } from "../../../../lib/service-errors";
import { addKitComponent } from "../../../../lib/kit-queries";
import { ITEM_ID } from "../../../../lib/item-lookups";

type Context = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: Context) {
  try {
    const manager = await requireRole(request, ["lab_manager"]);
    const { id } = await context.params;
    if (!ITEM_ID.test(id)) return Response.json({ error: "Invalid kit ID." }, { status: 400 });
    const body: unknown = await request.json().catch(() => null);
    const componentId = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).tracked_item_id : undefined;
    if (typeof componentId !== "string" || !UUID.test(componentId)) return Response.json({ error: "Choose a valid component item." }, { status: 400 });
    const component = await addKitComponent(id, manager.lab_id, componentId);
    if (!component) return Response.json({ error: "Kit not found." }, { status: 404 });
    return Response.json(component, { status: 201 });
  } catch (error) {
    const unavailable = equipmentFailure(error);
    if (unavailable) return unavailable;
    if (error instanceof AuthorizationError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "23505") return Response.json({ error: "That item is already a component of this kit.", code: "duplicate_component" }, { status: 409 });
    if (["23503", "23514", "KIT_COMPONENT_INVALID", "KIT_COMPONENT_INELIGIBLE"].includes(code)) return Response.json({ error: error instanceof Error ? error.message : "Invalid component item.", code: "invalid_component" }, { status: 400 });
    return Response.json({ error: "Could not add this component.", code: "kit_unavailable" }, { status: 503 });
  }
}
