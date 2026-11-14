import { requireUser } from "../../../lib/authorization";
import { isProfileId } from "@unitrack/contracts";
import { findProfileNames } from "../../../lib/profiles";
import { usersFailure } from "../../../lib/errors";
export async function GET(request: Request) {
 try {
  const actor = await requireUser(request, ["lab_assistant", "lab_manager"]);
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = raw ? raw.split(",") : [];
  if (ids.length > 100 || ids.some(id => !isProfileId(id))) return Response.json({ error: "Invalid profile IDs. Maximum batch size is 100." }, { status: 400 });
  return Response.json(await findProfileNames([...new Set(ids)], actor.lab_id), { headers: { "Cache-Control": "no-store" } });
 } catch (error) { return usersFailure(error); }
}
