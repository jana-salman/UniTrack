import { isProfileId } from "@unitrack/contracts";
import { requireUser } from "../../../lib/authorization";
import { LoansError, loansFailure } from "../../../lib/errors";
import { handoverEquipmentHttp } from "../../../lib/equipment-http";
import { getHandoverDetails } from "../../../lib/handover/queries";
import { confirmHandover } from "../../../lib/handover/service";

type Context = { params: Promise<{ reservationId: string }> };
const headers = (rid: string) => ({ "Cache-Control": "private, no-store", "X-Request-Id": rid });

// Handover is lab-assistant only. The signed identity supplies role and lab;
// the browser never does.
export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireUser(request, ["lab_assistant"]);
    const { reservationId } = await context.params;
    if (!isProfileId(reservationId)) throw new LoansError(400, "invalid_reservation", "Invalid reservation ID.");
    const details = await getHandoverDetails(reservationId.toLowerCase(), actor.lab_id);
    if (!details) throw new LoansError(404, "reservation_not_found", "Reservation not found.");
    return Response.json(details, { headers: headers(actor.rid) });
  } catch (error) { return loansFailure(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireUser(request, ["lab_assistant"]);
    const { reservationId } = await context.params;
    if (!isProfileId(reservationId)) throw new LoansError(400, "invalid_reservation", "Invalid reservation ID.");
    let body: unknown;
    try { body = await request.json(); } catch { throw new LoansError(400, "invalid_handover", "Invalid handover information. Check every component."); }
    return Response.json(await confirmHandover(reservationId, body, actor, handoverEquipmentHttp(actor)), { headers: headers(actor.rid) });
  } catch (error) { return loansFailure(error); }
}
