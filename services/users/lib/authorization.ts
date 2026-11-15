import "server-only";
import { verifyInternalToken } from "@unitrack/internal-auth";
import { isProfileId, type ProfileRole } from "@unitrack/contracts";
import { AuthorizationError } from "./auth/errors";
import { UsersError } from "./errors";
import { findProfileById } from "./profiles";
export async function readIdentity(request: Request) {
 const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get("Authorization") ?? "")?.[1];
 if (!token) throw new AuthorizationError(401, "unauthenticated", "Sign in is required.");
 const secret = process.env.INTERNAL_JWT_SECRET;
 if (!secret?.trim()) throw new UsersError(503, "users_not_configured", "Users service is not configured.");
 try { return await verifyInternalToken(token, secret); }
 catch { throw new AuthorizationError(401, "unauthenticated", "Sign in is required."); }
}
export async function requireGateway(request: Request) {
 const identity = await readIdentity(request);
 if (identity.kind !== "service" || identity.sub !== "gateway") throw new AuthorizationError(403, "insufficient_role", "You do not have permission to perform this action.");
 return identity;
}
export async function requireUser(request: Request, roles: readonly ProfileRole[]) {
 const identity = await readIdentity(request);
 if (identity.kind !== "user" || !roles.includes(identity.role)) throw new AuthorizationError(403, "insufficient_role", "You do not have permission to perform this action.");
 if (!isProfileId(identity.sub)) throw new AuthorizationError(401, "unauthenticated", "Sign in is required.");
 // Users owns actor state: reject inactive, moved-lab or stale privileged identities immediately.
 const actor = await findProfileById(identity.sub);
 if (!actor?.is_active || actor.role !== identity.role || actor.lab_id !== identity.lab_id) throw new AuthorizationError(403, "insufficient_role", "You do not have permission to perform this action.");
 return actor;
}
