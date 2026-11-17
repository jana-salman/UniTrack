import { requireUser } from "../../../../lib/authorization";
import { loansFailure } from "../../../../lib/errors";
import { getOwnReturnProblems } from "../../../../lib/returns/history";
export async function GET(request: Request) {
  try {
    const actor = await requireUser(request, ["student"]);
    // No borrower ID, role or laboratory is accepted from the URL/body.
    return Response.json(await getOwnReturnProblems(actor.sub, actor.lab_id), { headers: { "Cache-Control": "private, no-store", "X-Request-Id": actor.rid } });
  } catch (error) { return loansFailure(error); }
}
