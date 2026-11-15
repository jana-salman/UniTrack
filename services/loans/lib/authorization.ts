import "server-only";
import { verifyInternalToken } from "@unitrack/internal-auth";
import { isProfileId, type ProfileRole, type UserIdentity } from "@unitrack/contracts";
import { LoansError, LoansConfigurationError } from "./errors";
export async function requireUser(request: Request, roles: readonly ProfileRole[]): Promise<UserIdentity> {
  const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) throw new LoansError(401, "unauthenticated", "Sign in is required.");
  const secret = process.env.INTERNAL_JWT_SECRET;
  if (!secret?.trim()) throw new LoansConfigurationError("authentication");
  let identity;
  try { identity = await verifyInternalToken(token, secret); }
  catch { throw new LoansError(401, "unauthenticated", "Sign in is required."); }
  if (identity.kind !== "user" || !roles.includes(identity.role)) throw new LoansError(403, "forbidden", "Permission denied.");
  if (!isProfileId(identity.sub)) throw new LoansError(401, "unauthenticated", "Sign in is required.");
  return identity;
}
