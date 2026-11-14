import { requireUser } from "../../lib/authorization";
import { listProfilesByLab } from "../../lib/profiles";
import { usersFailure } from "../../lib/errors";
export async function GET(request: Request) {
 try {
  const actor = await requireUser(request, ["lab_manager"]);
  const raw = new URL(request.url).searchParams.get("labId") ?? "";
  const lab = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(lab) || String(lab) !== raw) return Response.json({ error: "Invalid laboratory ID." }, { status: 400 });
  if (lab !== actor.lab_id) return Response.json({ error: "Laboratory access denied." }, { status: 403 });
  return Response.json(await listProfilesByLab(actor.lab_id), { headers: { "Cache-Control": "no-store" } });
 } catch (error) { return usersFailure(error); }
}
