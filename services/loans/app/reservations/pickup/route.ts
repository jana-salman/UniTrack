
import { isProfileId } from "@unitrack/contracts";
import { requireUser } from "../../../lib/authorization";
import { LoansError, loansFailure } from "../../../lib/errors";
import { getPickupMatch } from "../../../lib/reservations/pickup-query";

export async function GET(request: Request) {
  try {
    // Reservation matching is restricted to laboratory assistants.
    const actor = await requireUser(request, ["lab_assistant"]);

    const itemId = new URL(request.url).searchParams.get("itemId");

    if (!itemId || !isProfileId(itemId)) {
      throw new LoansError(
        400,
        "invalid_item",
        "A valid equipment item ID is required.",
      );
    }

    const match = await getPickupMatch(itemId, actor.lab_id);

    return Response.json(match, {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Request-Id": actor.rid,
      },
    });
  } catch (error) {
    return loansFailure(error);
  }
}
