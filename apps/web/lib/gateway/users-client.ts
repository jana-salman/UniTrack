import "server-only";
import { createServiceCaller } from "./call-service";
import { USERS_ERROR_CONTRACT, type InternalIdentity } from "@unitrack/contracts";
export class UsersServiceUnavailableError extends Error {
 constructor() { super("User profiles are temporarily unavailable."); this.name = "UsersServiceUnavailableError"; }
}
// Transport only: deliberately no authorization/profile/session imports (bootstrap must not recurse).
export async function callUsers(path: string, identity: InternalIdentity, options: { method?: "GET" | "PATCH"; body?: unknown } = {}) {
 try {
  const call = createServiceCaller({ baseUrl: process.env.USERS_SERVICE_URL ?? "", secret: process.env.INTERNAL_JWT_SECRET ?? "", errorContract: USERS_ERROR_CONTRACT });
  return await call(path, identity, options);
 } catch { return Response.json({ error: "User profiles are temporarily unavailable.", code: "users_unavailable" }, { status: 503 }); }
}
