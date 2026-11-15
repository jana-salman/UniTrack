import "server-only";
import { getAuthenticatedProfile } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/errors";
import { getRequestId } from "@unitrack/internal-auth";
import {
  EQUIPMENT_ERROR_CONTRACT,
  LOANS_ERROR_CONTRACT,
  USERS_ERROR_CONTRACT,
  isEquipmentComponentSnapshot,
  isEquipmentItemSnapshot,
  isProfileName,
  isProfileRole,
  isReturnDetails,
  isReturnOutcome,
  type UserIdentity,
} from "@unitrack/contracts";
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
      const response = await callLoans("/returns/" + encodeURIComponent(loanId), identity, { method: "POST", body });
      if (!response.ok) return privateResponse(response);
      const outcome: unknown = await response.json();
      if (!isReturnOutcome(outcome) || outcome.loanId.toLowerCase() !== loanId.toLowerCase()) {
        return invalidServiceResponse(identity.rid);
      }
      return Response.json(outcome, {
        status: response.status,
        headers: { "Cache-Control": "private, no-store", "X-Request-Id": identity.rid },
      });
    }
    const response = await callLoans("/returns/" + encodeURIComponent(loanId), identity);
    if (!response.ok) return privateResponse(response);
    // Loans has already authorized this operation. Borrower data is additionally
    // guarded here; never make the Users name request for a student/professor.
    if (identity.role !== "lab_assistant") return Response.json({ error: "Permission denied." }, { status: 403 });
    const detailsPayload: unknown = await response.json();
    if (!isReturnDetails(detailsPayload)
      || detailsPayload.loan.id.toLowerCase() !== loanId.toLowerCase()
      || detailsPayload.loan.lab_id !== identity.lab_id) {
      return invalidServiceResponse(identity.rid);
    }
    const details = detailsPayload;
    const callEquipment = createServiceCaller({ baseUrl: process.env.EQUIPMENT_SERVICE_URL ?? "", secret: process.env.INTERNAL_JWT_SECRET ?? "", errorContract: EQUIPMENT_ERROR_CONTRACT });
    const callUsers = createServiceCaller({ baseUrl: process.env.USERS_SERVICE_URL ?? "", secret: process.env.INTERNAL_JWT_SECRET ?? "", errorContract: USERS_ERROR_CONTRACT });
    const [item, components, borrower] = await Promise.all([
      callEquipment("/items/" + encodeURIComponent(details.loan.item_id), identity),
      callEquipment("/items/" + encodeURIComponent(details.loan.item_id) + "/components", identity),
      callUsers("/profiles/batch?ids=" + encodeURIComponent(details.loan.borrower_id), identity),
    ]);
    const itemPayload: unknown = item.ok ? await item.json() : null;
    const componentsPayload: unknown = components.ok ? await components.json() : null;
    const borrowerPayload: unknown = borrower.ok ? await borrower.json() : null;
    const itemData = isEquipmentItemSnapshot(itemPayload)
      && itemPayload.id === details.loan.item_id
      && itemPayload.lab_id === identity.lab_id
      ? itemPayload
      : null;
    const componentData = Array.isArray(componentsPayload)
      && componentsPayload.every(isEquipmentComponentSnapshot)
      ? componentsPayload
      : null;
    const borrowerData = Array.isArray(borrowerPayload)
      && borrowerPayload.every(isProfileName)
      && borrowerPayload.every(entry => entry.id === details.loan.borrower_id)
      ? borrowerPayload
      : null;
    const partial = itemData === null || componentData === null || borrowerData === null;
    return Response.json({
      ...details,
      equipment: {
        name: itemData?.name ?? "Equipment name unavailable",
        components: (componentData ?? []).map(entry => ({ id: entry.id, name: entry.component_name })),
      },
      borrower: { name: borrowerData?.[0]?.full_name ?? null },
      ...(partial ? { partialData: true } : {}),
    }, { headers: { "Cache-Control": "private, no-store", "X-Request-Id": identity.rid } });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return Response.json({ error: "Loans is not configured or unavailable.", code: "loans_unavailable" }, { status: 503 });
  }
}
function privateResponse(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function invalidServiceResponse(requestId: string): Response {
  return Response.json(
    { error: "Invalid service response.", code: "service_response" },
    { status: 502, headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } },
  );
}
