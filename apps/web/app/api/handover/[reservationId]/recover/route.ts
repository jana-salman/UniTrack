import { forwardHandover } from "@/lib/gateway/handover";
// Finish/undo an interrupted handover from the durable Loans plan. No body.
export async function POST(request: Request, context: { params: Promise<{ reservationId: string }> }) {
  return forwardHandover(request, (await context.params).reservationId, "recover");
}
