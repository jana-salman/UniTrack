import "server-only";
import { signInternalToken } from "@unitrack/internal-auth";
import type { ApiError, InternalIdentity } from "@unitrack/contracts";

export const SERVICE_TIMEOUT_MS = 5000;
interface ServiceConfig { baseUrl: string; secret: string; errorContract?: { messages: readonly string[]; codes: readonly string[] } }
interface ServiceRequest { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD"; body?: unknown; idempotencyKey?: string }
function failure(status: number, error: string, code: string, rid?: string) {
  return Response.json({ error, code } satisfies ApiError, {
    status, headers: rid ? { "X-Request-Id": rid } : undefined,
  });
}
const expectedErrors: Record<number, string> = {
  400: "Invalid service request.", 401: "Service authentication required.",
  403: "Service permission denied.", 404: "Service resource not found.",
  409: "Service request conflicts with current state.", 422: "Service request could not be processed.",
  429: "Service request limit reached.", 500: "Service failed to process the request.",
  502: "Upstream service unavailable.", 503: "Service temporarily unavailable.", 504: "Service request timed out.",
};

// Instantiate ONLY from trusted server configuration. Never pass a browser URL here.
// The identity must come from the existing authenticated server session/profile.
export function createServiceCaller(config: ServiceConfig) {
  let base: URL;
  try {
    base = new URL(config.baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error();
  } catch { throw new Error("Invalid service configuration."); }
  const secret = config.secret;
  return async function callService(path: string, identity: InternalIdentity, request: ServiceRequest = {}): Promise<Response> {
    let url: URL;
    try {
      if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[\r\n]/.test(path)) throw new Error();
      url = new URL(path, base);
      if (url.origin !== base.origin || url.hash) throw new Error();
    } catch { return failure(500, "Invalid service request configuration.", "service_configuration"); }
    let token: string;
    try { token = await signInternalToken(identity, secret); }
    catch { return failure(500, "Service authentication is not configured correctly.", "service_configuration"); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SERVICE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: request.method ?? "GET",
        headers: { Authorization: "Bearer " + token, "X-Request-Id": identity.rid, "Content-Type": "application/json", ...(request.idempotencyKey === undefined ? {} : { "Idempotency-Key": request.idempotencyKey }) },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal, redirect: "error", cache: "no-store", credentials: "omit",
      });
      if (!response.ok) {
        // Explicit wire vocabulary preserves meaningful domain errors without free text.
        if (config.errorContract && expectedErrors[response.status] && response.headers.get("content-type")?.includes("application/json")) {
          let data: unknown;
          try { data = await response.json(); } catch { if (controller.signal.aborted) throw new Error(); }
          if (data && typeof data === "object" && !Array.isArray(data)) {
            const value = data as Record<string, unknown>;
            const fields = value.errors;
            const safeFields = Array.isArray(fields) && fields.length > 0 && fields.every(v => typeof v === "string" && config.errorContract!.messages.includes(v));
            const safeMessage = typeof value.error === "string" && (config.errorContract.messages.includes(value.error) || (safeFields && value.error === fields.join(" ")));
            const safeCode = value.code === undefined || (typeof value.code === "string" && config.errorContract.codes.includes(value.code));
            const serialized = JSON.stringify(data);
            if ((safeMessage || (value.error === undefined && safeFields)) && safeCode && !serialized.includes(token) && !serialized.includes(JSON.stringify(secret).slice(1, -1))) {
              return Response.json({ ...(safeMessage ? { error: value.error } : {}), ...(safeFields ? { errors: fields } : {}), ...(value.code ? { code: value.code } : {}) }, { status: response.status, headers: { "X-Request-Id": identity.rid } });
            }
          }
        }
        // Preserve expected status, never relay arbitrary upstream text/headers.
        return expectedErrors[response.status]
          ? failure(response.status, expectedErrors[response.status], "upstream_" + response.status, identity.rid)
          : failure(502, "Invalid service response.", "service_response", identity.rid);
      }
      if (response.status === 204 || request.method === "HEAD") return new Response(null, { status: response.status, headers: { "X-Request-Id": identity.rid } });
      if (!response.headers.get("content-type")?.includes("application/json")) return failure(502, "Invalid service response.", "service_response", identity.rid);
      const data: unknown = await response.json();
      // Never return accidentally echoed transport credentials, even on HTTP 200.
      const serialized = JSON.stringify(data);
      if (serialized.includes(token) || serialized.includes(JSON.stringify(secret).slice(1, -1))) {
        return failure(502, "Invalid service response.", "service_response", identity.rid);
      }
      return Response.json(data, { status: response.status, headers: { "X-Request-Id": identity.rid } });
    } catch {
      return controller.signal.aborted
        ? failure(504, "Service request timed out.", "service_timeout", identity.rid)
        : failure(502, "Service unavailable.", "service_unavailable", identity.rid);
    } finally { clearTimeout(timer); controller.abort(); }
  };
}
