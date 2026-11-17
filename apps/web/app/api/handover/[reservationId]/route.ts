import { forwardHandover } from "@/lib/gateway/handover";
type Context = { params: Promise<{ reservationId: string }> };
export async function GET(request: Request, context: Context) { return forwardHandover(request, (await context.params).reservationId); }
export async function POST(request: Request, context: Context) { return forwardHandover(request, (await context.params).reservationId); }
