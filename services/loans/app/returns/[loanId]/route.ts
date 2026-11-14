import { isProfileId } from "@unitrack/contracts";
import { requireUser } from "../../../lib/authorization";
import { LoansError, loansFailure } from "../../../lib/errors";
import { getReturnDetails } from "../../../lib/returns/queries";
import { confirmReturn } from "../../../lib/returns/service";
import { equipmentHttp } from "../../../lib/equipment-http";
import { validateReturnInput } from "../../../lib/returns/validation";
type Context = { params: Promise<{ loanId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireUser(request, ["lab_assistant"]);
    const { loanId } = await context.params;
    if (!isProfileId(loanId)) throw new LoansError(400, "invalid_loan", "Invalid loan ID.");
    const details = await getReturnDetails(loanId, actor.lab_id);
    if (!details) throw new LoansError(404, "loan_not_found", "Loan not found.");
    return Response.json(details, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return loansFailure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireUser(request, ["lab_assistant"]);
    const { loanId } = await context.params;
    if (!isProfileId(loanId)) throw new LoansError(400, "invalid_loan", "Invalid loan ID.");
    let body: unknown;
    try { body = await request.json(); } catch { throw new LoansError(400, "invalid_return", "Invalid return information. Check every condition."); }
    try {
      const input = validateReturnInput(body);
      if (input.conditions.length > 101 || input.conditions.some(row => (row.kitComponentId !== null && !isProfileId(row.kitComponentId)) || (row.notes?.length ?? 0) > 5000)) throw 0;
      body = input;
    } catch { throw new LoansError(400, "invalid_return", "Invalid return information. Check every condition."); }
    return Response.json(await confirmReturn(loanId, body, actor, equipmentHttp(actor)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return loansFailure(error); }
}
