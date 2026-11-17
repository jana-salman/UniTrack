import "server-only";
import { AuthorizationError } from "@/lib/auth/errors";
import {
  EQUIPMENT_ERROR_CONTRACT,
  USERS_ERROR_CONTRACT,
  isEquipmentComponentSnapshot,
  isEquipmentItemSnapshot,
  isHandoverDetails,
  isHandoverOutcome,
  isProfileName,
} from "@unitrack/contracts";
import type { HandoverView } from "@/lib/handover-view";
import { createServiceCaller } from "./call-service";
import { callLoans, trustedIdentity } from "./loans";

const noStore = (rid?: string) => ({ "Cache-Control": "private, no-store", ...(rid ? { "X-Request-Id": rid } : {}) });

/**
 * S2-09 handover gateway. The Web server enforces lab-assistant access BEFORE
 * any service call; Loans enforces it again. Role, user and lab come only from
 * the verified Supabase session/profile, never from browser headers or body.
 */
export async function forwardHandover(request: Request, reservationId: string): Promise<Response> {
  try {
    const identity = await trustedIdentity(request);
    if (identity.role !== "lab_assistant") return Response.json({ error: "Permission denied.", code: "forbidden" }, { status: 403, headers: noStore(identity.rid) });
    const path = "/handover/" + encodeURIComponent(reservationId);

    if (request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Request origin is not permitted." }, { status: 403, headers: noStore() });
      let body: unknown;
      try { body = await request.json(); } catch { body = null; }
      const response = await callLoans(path, identity, { method: "POST", body });
      if (!response.ok) return privateResponse(response);
      const outcome: unknown = await response.json();
      if (!isHandoverOutcome(outcome) || outcome.reservationId.toLowerCase() !== reservationId.toLowerCase()) return invalidServiceResponse(identity.rid);
      return Response.json({
        loanId: outcome.loanId, reservationId: outcome.reservationId, itemId: outcome.itemId, borrowerId: outcome.borrowerId,
        borrowedAt: outcome.borrowedAt, dueDate: outcome.dueDate, studentConfirmedAt: outcome.studentConfirmedAt, status: outcome.status,
      }, { headers: noStore(identity.rid) });
    }

    const response = await callLoans(path, identity);
    if (!response.ok) return privateResponse(response);
    const details: unknown = await response.json();
    if (!isHandoverDetails(details)
      || details.reservation.id.toLowerCase() !== reservationId.toLowerCase()
      || details.reservation.lab_id !== identity.lab_id) return invalidServiceResponse(identity.rid);

    // Loans authorized the reservation. Aggregate authoritative labels/state.
    const callEquipment = optionalCaller(process.env.EQUIPMENT_SERVICE_URL, EQUIPMENT_ERROR_CONTRACT);
    const callUsers = optionalCaller(process.env.USERS_SERVICE_URL, USERS_ERROR_CONTRACT);
    const itemPath = "/items/" + encodeURIComponent(details.reservation.item_id);
    const [item, components, borrower] = await Promise.all([
      callEquipment(itemPath, identity),
      callEquipment(itemPath + "/components", identity),
      callUsers("/profiles/batch?ids=" + encodeURIComponent(details.reservation.borrower_id), identity),
    ]);
    const itemPayload: unknown = item.ok ? await item.json() : null;
    const componentPayload: unknown = components.ok ? await components.json() : null;
    const borrowerPayload: unknown = borrower.ok ? await borrower.json() : null;
    const itemData = isEquipmentItemSnapshot(itemPayload) && itemPayload.id === details.reservation.item_id && itemPayload.lab_id === identity.lab_id ? itemPayload : null;
    const componentData = Array.isArray(componentPayload) && componentPayload.every(row => isEquipmentComponentSnapshot(row)
      && typeof (row as unknown as Record<string, unknown>).is_active === "boolean"
      && typeof (row as unknown as Record<string, unknown>).is_required === "boolean")
      ? componentPayload as unknown as { id: string; component_name: string; is_active: boolean; is_required: boolean }[]
      : null;
    const borrowerData = Array.isArray(borrowerPayload) && borrowerPayload.every(isProfileName)
      && borrowerPayload.every(row => row.id === details.reservation.borrower_id) ? borrowerPayload : null;
    const assetCode = itemData && typeof (itemData as unknown as Record<string, unknown>).asset_code === "string" ? (itemData as unknown as Record<string, string>).asset_code : null;

    const view: HandoverView = {
      reservation: {
        id: details.reservation.id, itemId: details.reservation.item_id, borrowerId: details.reservation.borrower_id,
        startAt: details.reservation.start_at, endAt: details.reservation.end_at, status: details.reservation.status,
      },
      handover: details.handover ? {
        loanId: details.handover.loanId, borrowedAt: details.handover.borrowedAt, dueDate: details.handover.dueDate,
        studentConfirmedAt: details.handover.studentConfirmedAt, returnedAt: details.handover.returnedAt,
        pickupConditions: details.handover.pickupConditions.map(row => ({ id: row.id, kitComponentId: row.kit_component_id, conditionStatus: row.condition_status, notes: row.notes })),
      } : null,
      pendingOperation: details.pendingOperation,
      equipment: itemData ? { name: itemData.name, assetCode, status: itemData.status } : null,
      // Only ACTIVE components, matching what Loans validates on submit.
      components: componentData ? componentData.filter(row => row.is_active).map(row => ({ id: row.id, name: row.component_name, required: row.is_required })) : null,
      borrower: { name: borrowerData?.[0]?.full_name ?? null },
      ...(itemData === null || componentData === null || borrowerData === null ? { partialData: true } : {}),
    };
    return Response.json(view, { headers: noStore(identity.rid) });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: noStore() });
    return Response.json({ error: "Loans is not configured or unavailable.", code: "loans_unavailable" }, { status: 503, headers: noStore() });
  }
}

function optionalCaller(baseUrl: string | undefined, errorContract: { messages: readonly string[]; codes: readonly string[] }): ReturnType<typeof createServiceCaller> {
  try { return createServiceCaller({ baseUrl: baseUrl ?? "", secret: process.env.INTERNAL_JWT_SECRET ?? "", errorContract }); }
  catch { return async () => Response.json({ error: "Service unavailable." }, { status: 503 }); }
}
function privateResponse(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
function invalidServiceResponse(requestId: string): Response {
  return Response.json({ error: "Invalid service response.", code: "service_response" }, { status: 502, headers: noStore(requestId) });
}
