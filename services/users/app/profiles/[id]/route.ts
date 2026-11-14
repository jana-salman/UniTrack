import { requireGateway } from "../../../lib/authorization";
import { isProfileId } from "@unitrack/contracts";
import { findProfileById } from "../../../lib/profiles";
import { usersFailure } from "../../../lib/errors";
export async function GET(request: Request, context: RouteContext<"/profiles/[id]">) {
 try {
  await requireGateway(request);
  const { id } = await context.params;
  if (!isProfileId(id)) return Response.json({ error: "Invalid user id." }, { status: 400 });
  const profile = await findProfileById(id);
  return profile ? Response.json(profile, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "User profile not found." }, { status: 404 });
 } catch (error) { return usersFailure(error); }
}
