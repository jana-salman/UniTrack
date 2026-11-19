import { isProfileId } from "@unitrack/contracts";
import { requireUser } from "../../../../lib/authorization";
import { LoansError, loansFailure } from "../../../../lib/errors";
import { handoverEquipmentHttp } from "../../../../lib/equipment-http";
import { usersHttp } from "../../../../lib/users-http";
import { recoverHandover } from "../../../../lib/handover/service";

// Finish (or, for the starting assistant, undo) an interrupted handover from
// its durable plan. No checklist or confirmation is accepted from the browser.
export async function POST(request: Request, context: { params: Promise<{ reservationId: string }> }) {
  try {
    const actor = await requireUser(request, ["lab_assistant"]);
    const { reservationId } = await context.params;
    if (!isProfileId(reservationId)) throw new LoansError(400, "invalid_reservation", "Invalid reservation ID.");
    const outcome = await recoverHandover(reservationId, actor, { equipment: handoverEquipmentHttp(actor), users: usersHttp(actor) });
    return Response.json(outcome, { headers: { "Cache-Control": "private, no-store", "X-Request-Id": actor.rid } });
  } catch (error) { return loansFailure(error); }
}
