import "server-only";
import { getAuthenticatedProfile } from "../auth/authorization";
import { AuthorizationError } from "../auth/errors";
import { getRequestId } from "@unitrack/internal-auth";
import { callUsers } from "./users-client";
export async function forwardUsers(request: Request, path: string) {
 try {
  const user = await getAuthenticatedProfile();
  let body: unknown;
  // Users must authorize the actor before reporting domain/body validation errors.
  try { body = await request.json(); } catch { body = null; }
  return await callUsers(path, { kind: "user", sub: user.id, role: user.role, lab_id: user.lab_id, rid: getRequestId(request.headers.get("X-Request-Id")) }, { method: "PATCH", body });
 } catch (error) {
  if (error instanceof AuthorizationError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  return Response.json({ error: "User profiles are temporarily unavailable.", code: "users_unavailable" }, { status: 503 });
 }
}
