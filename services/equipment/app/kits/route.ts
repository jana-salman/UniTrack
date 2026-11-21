import { requireRole } from "../../lib/auth/authorization";
import { AuthorizationError } from "../../lib/auth/errors";
import { equipmentFailure } from "../../lib/service-errors";
import { createKit, listKits } from "../../lib/kit-queries";
import { validateCreateEquipmentInput, type CreateEquipmentInput } from "../../lib/equipment-validation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const errorResponse = (error: unknown) => {
  const unavailable = equipmentFailure(error);
  if (unavailable) return unavailable;
  if (error instanceof AuthorizationError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "23505") return Response.json({ error: "A kit or component with that identifier already exists.", code: "kit_conflict" }, { status: 409 });
  if (["23503", "23514", "KIT_COMPONENT_INVALID", "KIT_COMPONENT_INELIGIBLE"].includes(code)) return Response.json({ error: error instanceof Error ? error.message : "Invalid kit or component.", code: "invalid_kit" }, { status: 400 });
  return Response.json({ error: "Could not process the kit request.", code: "kit_unavailable" }, { status: 503 });
};

export async function GET(request: Request) {
  try {
    const manager = await requireRole(request, ["lab_manager"]);
    return Response.json(await listKits(manager.lab_id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const manager = await requireRole(request, ["lab_manager"]);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Kit data must be an object." }, { status: 400 });
    const submitted = body as Record<string, unknown>;
    const ids = submitted.componentIds;
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every(id => typeof id === "string" && UUID.test(id)) || new Set(ids).size !== ids.length) {
      return Response.json({ error: "Choose a valid list of distinct component items." }, { status: 400 });
    }
    const item: Record<string, unknown> = { ...submitted, lab_id: manager.lab_id };
    delete item["componentIds"];
    const errors = validateCreateEquipmentInput(item);
    if (errors.length) return Response.json({ error: "Invalid kit information.", errors }, { status: 400 });
    const kit = await createKit(item as unknown as CreateEquipmentInput, manager.id, ids as string[]);
    return Response.json(kit, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
