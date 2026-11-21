import { forwardReservation } from "@/lib/gateway/loans";

export function POST(request: Request) {
  return forwardReservation(request);
}
