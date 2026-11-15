import "server-only";
import { getAuthenticatedProfile } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/errors";
import { getRequestId } from "@unitrack/internal-auth";
import { EQUIPMENT_ERROR_CONTRACT, isProfileRole } from "@unitrack/contracts";
import { createServiceCaller } from "./call-service";

// No Equipment SQL or domain authorization in this gateway.
export async function forwardEquipment(request: Request, path: string): Promise<Response> {
  try {
    const profile = await getAuthenticatedProfile();
    if (!isProfileRole(profile.role) || !Number.isSafeInteger(profile.lab_id) || profile.lab_id <= 0) {
      return Response.json({ error: "User is not assigned to a valid laboratory." }, { status: 403 });
    }
    const identity = { kind: "user" as const, sub: profile.id, role: profile.role, lab_id: profile.lab_id, rid: getRequestId(request.headers.get("X-Request-Id")) };
    const call = createServiceCaller({ baseUrl: process.env.EQUIPMENT_SERVICE_URL ?? "", secret: process.env.INTERNAL_JWT_SECRET ?? "", errorContract: EQUIPMENT_ERROR_CONTRACT });
    const method = request.method as "GET" | "POST" | "PATCH";
    let body: unknown;
    if (method !== "GET") {
      try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
    }
    return await call(path, identity, { method, body, idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return Response.json({ error: "Equipment service is not configured or unavailable.", code: "equipment_unavailable" }, { status: 503 });
  }
}
