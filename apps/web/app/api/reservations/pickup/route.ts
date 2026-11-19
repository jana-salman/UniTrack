
import { forwardPickupMatch } from "@/lib/gateway/pickup-match";

export async function GET(request: Request) {
  return forwardPickupMatch(request);
}
