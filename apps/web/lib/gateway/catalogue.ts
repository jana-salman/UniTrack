import "server-only";
import { AuthorizationError } from "@/lib/auth/errors";
import {
  EQUIPMENT_ERROR_CONTRACT,
  isCatalogueItem,
  isLoanDueDate,
  type CatalogueItem,
} from "@unitrack/contracts";
import { createServiceCaller } from "./call-service";
import { callLoans, trustedIdentity } from "./loans";

export async function catalogue(request: Request): Promise<Response> {
  try {
    const identity = await trustedIdentity(request);
    const response = await createServiceCaller({ baseUrl: process.env.EQUIPMENT_SERVICE_URL ?? "", secret: process.env.INTERNAL_JWT_SECRET ?? "", errorContract: EQUIPMENT_ERROR_CONTRACT })("/items" + new URL(request.url).search, identity);
    if (!response.ok) return response;
    const itemPayload: unknown = await response.json();
    if (!Array.isArray(itemPayload) || !itemPayload.every(isCatalogueItem)) {
      return Response.json(
        { error: "Invalid service response.", code: "service_response" },
        { status: 502, headers: { "X-Request-Id": identity.rid } },
      );
    }
    const items: CatalogueItem[] = itemPayload;
    let partial = false;
    const dates = new Map<string, string>();
    // Bounded requests support catalogues larger than the due-date batch limit.
    for (let offset = 0; offset < items.length; offset += 100) {
      const ids = items.slice(offset, offset + 100).map(item => item.id);
      try {
        const due = await callLoans("/loans/due-dates?itemIds=" + encodeURIComponent(ids.join(",")), identity);
        if (!due.ok) throw 0;
        const rows: unknown = await due.json();
        if (!Array.isArray(rows) || rows.some(row => !isLoanDueDate(row) || !ids.includes(row.itemId))) throw 0;
        for (const row of rows) dates.set(row.itemId, row.dueDate);
      } catch { partial = true; }
    }
    return Response.json(items.map(item => ({ ...item, canReserve: identity.role === "student", expectedReturn: dates.get(item.id) ?? null })), { headers: { "Cache-Control": "private, no-store", "X-Request-Id": identity.rid, ...(partial ? { "X-UniTrack-Partial-Data": "loans-due-dates" } : {}) } });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return Response.json({ error: "Catalogue is unavailable." }, { status: 503 });
  }
}
