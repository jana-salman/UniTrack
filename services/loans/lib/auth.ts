import "server-only";
import { verifyInternalToken } from "@unitrack/internal-auth";
import type { ApiError, InternalIdentity, ProfileRole } from "@unitrack/contracts";

interface AuthOptions { secret: string; roles: readonly (ProfileRole | "service")[] }
type Handler = (request: Request, identity: InternalIdentity) => Promise<Response> | Response;

// Read configuration at request time in future handlers, never from browser claims.
export function withInternalAuth(handler: Handler, options: AuthOptions) {
  return async function protectedHandler(request: Request): Promise<Response> {
    let identity: InternalIdentity;
    try {
      const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") ?? "");
      identity = await verifyInternalToken(match?.[1], options.secret);
    } catch {
      return Response.json({ error: "Authentication required.", code: "unauthorized" } satisfies ApiError, { status: 401 });
    }
    if (!options.roles.includes(identity.role)) {
      return Response.json({ error: "Permission denied.", code: "forbidden" } satisfies ApiError, { status: 403 });
    }
    // Identity.rid is signed. Never treat X-Request-Id as identity or permission.
    return handler(request, identity);
  };
}
