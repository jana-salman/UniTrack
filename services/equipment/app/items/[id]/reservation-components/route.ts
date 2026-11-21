import { PROFILE_ROLES } from "@unitrack/contracts";
import { requireRole } from "../../../../lib/auth/authorization";
import { getItem, ITEM_ID } from "../../../../lib/item-lookups";
import { getReservationComponents } from "../../../../lib/kit-queries";
import { lookupError } from "../../../../lib/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole(request, PROFILE_ROLES);
    const { id } = await context.params;
    if (!ITEM_ID.test(id)) return Response.json({ error: "Invalid equipment ID." }, { status: 400 });
    const item = await getItem(id, actor.lab_id);
    if (!item) return Response.json({ error: "Equipment not found or access denied." }, { status: 404 });
    return Response.json(await getReservationComponents(id, actor.lab_id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return lookupError(error); }
}
