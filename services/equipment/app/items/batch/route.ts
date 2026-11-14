import { NextResponse } from "next/server";
import { requireRole } from "../../../lib/auth/authorization";
import { PROFILE_ROLES } from "@unitrack/contracts";
import { getItemsByIds, ITEM_ID } from "../../../lib/item-lookups";
import { lookupError } from "../../../lib/http";
export async function GET(request: Request) {
  try {
    const user = await requireRole(request, PROFILE_ROLES);
    const raw = new URL(request.url).searchParams.get("ids") ?? "";
    const ids = raw ? raw.split(",") : [];
    if (ids.length > 100 || ids.some(id => !ITEM_ID.test(id))) return NextResponse.json({ error: "Invalid item IDs. Maximum batch size is 100." }, { status: 400 });
    return NextResponse.json(await getItemsByIds([...new Set(ids)], user.lab_id));
  } catch (error) { return lookupError(error); }
}
