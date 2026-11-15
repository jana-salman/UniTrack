import { AuthorizationError } from "./auth/errors";
export class UsersError extends Error {
  constructor(public readonly status: 400 | 404 | 503, public readonly code: string, message: string) { super(message); }
}
export function usersFailure(error: unknown) {
  if (error instanceof UsersError || error instanceof AuthorizationError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "42P01" || code === "42703") return Response.json({ error: "Users database schema is not ready.", code: "users_schema_not_ready" }, { status: 503 });
  if (["28P01", "42501", "28000", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "08006"].includes(String(code))) return Response.json({ error: "Users database access is unavailable.", code: "users_database_unavailable" }, { status: 503 });
  return Response.json({ error: "Unable to retrieve profiles.", code: "users_unavailable" }, { status: 500 });
}
