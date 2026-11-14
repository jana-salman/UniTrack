import { NextResponse } from "next/server";
import { requireRole } from "../../../../lib/auth/authorization";
import { getItem, getComponents, ITEM_ID } from "../../../../lib/item-lookups";
import { lookupError } from "../../../../lib/http";
export async function GET(request: Request, context: RouteContext<"/items/[id]/components">) {
  try {
    const user = await requireRole(request, ["lab_manager", "lab_assistant", "professor"]);
    const { id } = await context.params;
    if (!ITEM_ID.test(id)) return NextResponse.json({ error: "Invalid equipment ID." }, { status: 400 });
    const item = await getItem(id, user.lab_id);
    if (!item) return NextResponse.json({ error: "Equipment not found or access denied." }, { status: 404 });
    return NextResponse.json(await getComponents(id, user.lab_id));
  } catch (error) { return lookupError(error); }
}
