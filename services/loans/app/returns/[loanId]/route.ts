import { isProfileId, type ReturnDetails } from "@unitrack/contracts";
import { requireUser } from "../../../lib/authorization";
import { LoansError, loansFailure } from "../../../lib/errors";
import { getReturnDetails } from "../../../lib/returns/queries";
import { confirmReturn } from "../../../lib/returns/service";
import { equipmentHttp } from "../../../lib/equipment-http";
import { validateReturnInput } from "../../../lib/returns/validation";
import { getReturnHistory } from "../../../lib/returns/history";
type Context = { params: Promise<{ loanId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireUser(request, ["lab_assistant"]);
    const { loanId } = await context.params;
    if (!isProfileId(loanId)) throw new LoansError(400, "invalid_loan", "Invalid loan ID.");
    const details = await getReturnDetails(loanId, actor.lab_id);
    if (!details) throw new LoansError(404, "loan_not_found", "Loan not found.");
    const response: ReturnDetails = {
      loan: {
        id: details.loan.id, item_id: details.loan.item_id, borrower_id: details.loan.borrower_id,
        reservation_id: details.loan.reservation_id, lab_id: details.loan.lab_id,
        borrowed_at: details.loan.borrowed_at.toISOString(),
        due_date: details.loan.due_date.toISOString(),
        returned_at: details.loan.returned_at?.toISOString() ?? null,
      },
      pickupConditions: details.pickupConditions,
      ...(details.loan.returned_at ? { returnHistory: await getReturnHistory(details.loan.id, details.loan.item_id, actor.lab_id, details.loan.returned_at, details.loan.due_date) } : {}),
    };
    return Response.json(response, { headers: { "Cache-Control": "private, no-store", "X-Request-Id": actor.rid } });
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
    return Response.json(await confirmReturn(loanId, body, actor, equipmentHttp(actor)), { headers: { "Cache-Control": "private, no-store", "X-Request-Id": actor.rid } });
  } catch (error) { return loansFailure(error); }
}
