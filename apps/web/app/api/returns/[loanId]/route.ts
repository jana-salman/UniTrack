import { forwardReturn } from "@/lib/gateway/loans";
type Context = { params: Promise<{ loanId: string }> };
export async function GET(request: Request, context: Context) { return forwardReturn(request, (await context.params).loanId); }
export async function POST(request: Request, context: Context) { return forwardReturn(request, (await context.params).loanId); }
