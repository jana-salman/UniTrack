import { NextResponse } from "next/server";
import { requireRole } from "../../../../lib/auth/authorization";
import { getItem, ITEM_ID } from "../../../../lib/item-lookups";
import { lookupError } from "../../../../lib/http";
export async function GET(request: Request, context: RouteContext<"/items/[id]/availability">) {
  try {
    const user = await requireRole(request, ["student", "lab_assistant", "professor", "lab_manager"]);
    const { id } = await context.params;
    if (!ITEM_ID.test(id)) return NextResponse.json({ error: "Invalid equipment ID." }, { status: 400 });
    const item = await getItem(id, user.lab_id);
    if (!item) return NextResponse.json({ error: "Equipment not found or access denied." }, { status: 404 });
    return NextResponse.json({ reservable: ["available", "reserved"].includes(item.status), status: item.status });
  } catch (error) { return lookupError(error); }
}
