import { PROFILE_ROLES, isProfileId } from "@unitrack/contracts";
import { requireUser } from "../../../lib/authorization";
import { LoansError, loansFailure } from "../../../lib/errors";
import { getDatabasePool } from "../../../lib/db";
export async function GET(request: Request) {
  try {
    const actor = await requireUser(request, PROFILE_ROLES);
    const raw = new URL(request.url).searchParams.get("itemIds") ?? "";
    const ids = raw ? raw.split(",") : [];
    if (ids.length > 100 || ids.some(id => !isProfileId(id))) throw new LoansError(400, "invalid_items", "Invalid item IDs. Maximum batch size is 100.");
    if (!ids.length) return Response.json([]);
    const result = await getDatabasePool().query<{ item_id: string; due_date: Date }>("select item_id, due_date from public.loans where lab_id = $1 and item_id = any($2::uuid[]) and returned_at is null", [actor.lab_id, [...new Set(ids)]]);
    // Explicit projection: never include loan/profile/reservation identifiers.
    return Response.json(result.rows.map(row => ({ itemId: row.item_id, dueDate: row.due_date.toISOString() })), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return loansFailure(error); }
}
