import { EquipmentConfigurationError } from "../service-errors";
import "server-only";
import { verifyInternalToken } from "@unitrack/internal-auth";
import type { ProfileRole } from "@unitrack/contracts";
import { AuthorizationError } from "./errors";

export async function requireRole(request: Request, roles: readonly ProfileRole[]) {
  const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) throw new AuthorizationError(401, "unauthenticated", "Sign in is required.");
  const secret = process.env.INTERNAL_JWT_SECRET;
  if (!secret?.trim()) throw new EquipmentConfigurationError("authentication");
  let identity;
  try {
    identity = await verifyInternalToken(token, secret);
  } catch { throw new AuthorizationError(401, "unauthenticated", "Sign in is required."); }
  if (identity.kind !== "user" || !roles.includes(identity.role)) {
    throw new AuthorizationError(403, "insufficient_role", "You do not have permission to perform this action.");
  }
  return { id: identity.sub, role: identity.role, lab_id: identity.lab_id };
}
