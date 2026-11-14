import type { ApiError } from "@unitrack/contracts";
export class EquipmentConfigurationError extends Error {
  constructor(kind: "database" | "authentication") {
    super(kind === "database" ? "Equipment database is not configured." : "Equipment authentication is not configured.");
  }
}
export function equipmentFailure(error: unknown): Response | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  let body: ApiError | undefined;
  if (error instanceof EquipmentConfigurationError) body = { error: error.message, code: "equipment_not_configured" };
  else if (code === "42703" || code === "42P01") body = { error: "Equipment database schema is not ready.", code: "equipment_schema_not_ready" };
  else if (code === "42501" || code === "28P01" || code === "28000") body = { error: "Equipment database access is not configured.", code: "equipment_database_access" };
  else if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "08006", "08001", "57P01"].includes(String(code))) body = { error: "Equipment database is unavailable.", code: "equipment_database_unavailable" };
  return body ? Response.json(body, { status: 503 }) : undefined;
}
