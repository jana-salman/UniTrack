import { SignJWT, jwtVerify } from "jose";
import { isProfileRole, type InternalIdentity } from "@unitrack/contracts";
import { isRequestId } from "./request-id.js";
export { getRequestId, isRequestId } from "./request-id.js";

export const INTERNAL_ISSUER = "unitrack-gateway";
export const TOKEN_LIFETIME_SECONDS = 60;
export class InternalAuthError extends Error {
  constructor() { super("Internal authentication failed."); this.name = "InternalAuthError"; }
}
function key(secret: string): Uint8Array {
  if (typeof secret !== "string" || !secret.trim()) throw new InternalAuthError();
  return new TextEncoder().encode(secret);
}
function identity(value: Record<string, unknown>): InternalIdentity {
  const { sub, role, lab_id, rid } = value;
  if (typeof sub !== "string" || !sub.trim() || sub !== sub.trim() || sub.length > 256 || !isRequestId(rid)) throw new InternalAuthError();
  if (role === "service" && sub === "gateway" && lab_id === null) {
    return { kind: "service", sub, role, lab_id, rid };
  }
  if (sub !== "gateway" && isProfileRole(role) && typeof lab_id === "number" && Number.isSafeInteger(lab_id) && lab_id > 0) {
    return { kind: "user", sub, role, lab_id, rid };
  }
  throw new InternalAuthError();
}

// The caller supplies INTERNAL_JWT_SECRET explicitly. No environment reads or logging.
export async function signInternalToken(input: InternalIdentity, secret: string): Promise<string> {
  try {
    const signingKey = key(secret);
    const checked = identity(input as unknown as Record<string, unknown>);
    if (input.kind !== checked.kind) throw new InternalAuthError();
    const now = Math.floor(Date.now() / 1000);
    return await new SignJWT({ role: checked.role, lab_id: checked.lab_id, rid: checked.rid })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(INTERNAL_ISSUER).setSubject(checked.sub).setIssuedAt(now)
      .setExpirationTime(now + TOKEN_LIFETIME_SECONDS).sign(signingKey);
  } catch { throw new InternalAuthError(); }
}
export async function verifyInternalToken(token: unknown, secret: string): Promise<InternalIdentity> {
  try {
    const verificationKey = key(secret);
    if (typeof token !== "string" || !token.trim()) throw new InternalAuthError();
    const { payload } = await jwtVerify(token, verificationKey, {
      algorithms: ["HS256"], issuer: INTERNAL_ISSUER,
      requiredClaims: ["sub", "role", "lab_id", "rid", "iat", "exp"],
      maxTokenAge: TOKEN_LIFETIME_SECONDS,
    });
    if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
        payload.exp! - payload.iat! !== TOKEN_LIFETIME_SECONDS) throw new InternalAuthError();
    return identity(payload);
  } catch { throw new InternalAuthError(); }
}
