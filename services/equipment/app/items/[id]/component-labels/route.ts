import { PROFILE_ROLES } from "@unitrack/contracts";
import { requireRole } from "../../../../lib/auth/authorization";
import { getItem, getComponents, ITEM_ID } from "../../../../lib/item-lookups";
import { lookupError } from "../../../../lib/http";

// Approved student permission: same-lab component labels only, never staff
// quantities, tracked inventory IDs or operational component metadata.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole(request, PROFILE_ROLES);
    const { id } = await context.params;
    if (!ITEM_ID.test(id)) return Response.json({ error: "Invalid equipment ID." }, { status: 400 });
    if (!(await getItem(id, actor.lab_id))) return Response.json({ error: "Equipment not found or access denied." }, { status: 404 });
    const rows = await getComponents(id, actor.lab_id);
    return Response.json(rows.map(row => ({ id: row.id, component_name: row.component_name })), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return lookupError(error); }
}
