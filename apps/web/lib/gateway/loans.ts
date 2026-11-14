import "server-only";
import { getAuthenticatedProfile } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/errors";
import { getRequestId } from "@unitrack/internal-auth";
import { EQUIPMENT_ERROR_CONTRACT, LOANS_ERROR_CONTRACT, USERS_ERROR_CONTRACT, isProfileRole, type UserIdentity } from "@unitrack/contracts";
import { createServiceCaller } from "./call-service";

export async function trustedIdentity(request: Request): Promise<UserIdentity> {
  const profile = await getAuthenticatedProfile();
  if (!isProfileRole(profile.role) || !Number.isSafeInteger(profile.lab_id) || profile.lab_id <= 0) throw new AuthorizationError(403, "invalid_lab", "User is not assigned to a laboratory.");
  return { kind: "user", sub: profile.id, role: profile.role, lab_id: profile.lab_id, rid: getRequestId(request.headers.get("X-Request-Id")) };
}
export function callLoans(path: string, identity: UserIdentity, options?: { method: "POST"; body: unknown }) {
  return createServiceCaller({ baseUrl: process.env.LOANS_SERVICE_URL ?? "", secret: process.env.INTERNAL_JWT_SECRET ?? "", errorContract: LOANS_ERROR_CONTRACT })(path, identity, options);
}
export async function forwardReturn(request: Request, loanId: string): Promise<Response> {
  try {
    const identity = await trustedIdentity(request);
    if (request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Request origin is not permitted." }, { status: 403 });
      let body: unknown;
      try { body = await request.json(); } catch { body = null; }
      return privateResponse(await callLoans("/returns/" + encodeURIComponent(loanId), identity, { method: "POST", body }));
    }
    const response = await callLoans("/returns/" + encodeURIComponent(loanId), identity);
    if (!response.ok) return privateResponse(response);
    // Loans has already authorized this operation. Borrower data is additionally
    // guarded here; never make the Users name request for a student/professor.
    if (identity.role !== "lab_assistant") return Response.json({ error: "Permission denied." }, { status: 403 });
    const details = await response.json();
    const callEquipment = createServiceCaller({ baseUrl: process.env.EQUIPMENT_SERVICE_URL ?? "", secret: process.env.INTERNAL_JWT_SECRET ?? "", errorContract: EQUIPMENT_ERROR_CONTRACT });
    const callUsers = createServiceCaller({ baseUrl: process.env.USERS_SERVICE_URL ?? "", secret: process.env.INTERNAL_JWT_SECRET ?? "", errorContract: USERS_ERROR_CONTRACT });
    const [item, components, borrower] = await Promise.all([
      callEquipment("/items/" + encodeURIComponent(details.loan.item_id), identity),
      callEquipment("/items/" + encodeURIComponent(details.loan.item_id) + "/components", identity),
      callUsers("/profiles/batch?ids=" + encodeURIComponent(details.loan.borrower_id), identity),
    ]);
    const partial = !item.ok || !components.ok || !borrower.ok;
    const itemData = item.ok ? await item.json() : null;
    const componentData = components.ok ? await components.json() : [];
    const borrowerData = borrower.ok ? await borrower.json() : [];
    return Response.json({ ...details, equipment: { name: itemData?.name ?? "Equipment name unavailable", components: componentData.map((entry: { id: string; component_name: string }) => ({ id: entry.id, name: entry.component_name })) }, borrower: { name: borrowerData[0]?.full_name ?? null }, ...(partial ? { partialData: true } : {}) }, { headers: { "Cache-Control": "private, no-store", "X-Request-Id": identity.rid } });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return Response.json({ error: "Loans is not configured or unavailable.", code: "loans_unavailable" }, { status: 503 });
  }
}
function privateResponse(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
