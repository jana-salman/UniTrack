import { requireUser } from "../../lib/authorization";
import { loansFailure } from "../../lib/errors";
import { listInterruptedHandovers } from "../../lib/handover/queries";

// Same-lab unfinished handovers so staff can find and finish them.
export async function GET(request: Request) {
  try {
    const actor = await requireUser(request, ["lab_assistant"]);
    return Response.json(await listInterruptedHandovers(actor.lab_id, actor.sub), { headers: { "Cache-Control": "private, no-store", "X-Request-Id": actor.rid } });
  } catch (error) { return loansFailure(error); }
}
