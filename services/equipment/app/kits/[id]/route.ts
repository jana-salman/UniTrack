import { requireRole } from "../../../lib/auth/authorization";
import { AuthorizationError } from "../../../lib/auth/errors";
import { equipmentFailure } from "../../../lib/service-errors";
import { getKit, updateKit } from "../../../lib/kit-queries";
import { validateUpdateEquipmentInput } from "../../../lib/equipment-validation";
import type { UpdateEquipmentInput } from "../../../lib/equipment-queries";
import { ITEM_ID } from "../../../lib/item-lookups";

type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  const unavailable = equipmentFailure(error);
  if (unavailable) return unavailable;
  if (error instanceof AuthorizationError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "23505") return Response.json({ error: "A kit or component with that identifier already exists.", code: "kit_conflict" }, { status: 409 });
  if (["23503", "23514"].includes(code)) return Response.json({ error: "Invalid kit information.", code: "invalid_kit" }, { status: 400 });
  return Response.json({ error: "Could not process the kit request.", code: "kit_unavailable" }, { status: 503 });
}

export async function GET(request: Request, context: Context) {
  try {
    const manager = await requireRole(request, ["lab_manager"]);
    const { id } = await context.params;
    if (!ITEM_ID.test(id)) return Response.json({ error: "Invalid kit ID." }, { status: 400 });
    const kit = await getKit(id, manager.lab_id);
    return kit ? Response.json(kit, { headers: { "Cache-Control": "private, no-store" } }) : Response.json({ error: "Kit not found." }, { status: 404 });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const manager = await requireRole(request, ["lab_manager"]);
    const { id } = await context.params;
    if (!ITEM_ID.test(id)) return Response.json({ error: "Invalid kit ID." }, { status: 400 });
    const body: unknown = await request.json().catch(() => null);
    const errors = validateUpdateEquipmentInput(body);
    if (errors.length) return Response.json({ error: "Invalid kit information.", errors }, { status: 400 });
    const kit = await updateKit(id, manager.lab_id, body as UpdateEquipmentInput);
    return kit ? Response.json(kit, { headers: { "Cache-Control": "private, no-store" } }) : Response.json({ error: "Kit not found." }, { status: 404 });
  } catch (error) { return failure(error); }
}
