import { requireUser } from "../../lib/authorization";
import { equipmentHttp } from "../../lib/equipment-http";
import { LoansError, loansFailure } from "../../lib/errors";
import { createReservation } from "../../lib/reservations/create";

export async function POST(request: Request) {
  try {
    const actor = await requireUser(request, ["student"]);
    const body: unknown = await request.json().catch(() => null);
    if (body === null) throw new LoansError(400, "invalid_reservation", "Choose an item and valid start and end dates.");
    const reservation = await createReservation(body, actor, equipmentHttp(actor));
    return Response.json(reservation, {
      status: 201,
      headers: { "Cache-Control": "private, no-store", "X-Request-Id": actor.rid },
    });
  } catch (error) {
    if (error instanceof LoansError) return loansFailure(error);
    return Response.json({ error: "Reservation could not be saved. Try again.", code: "reservation_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
