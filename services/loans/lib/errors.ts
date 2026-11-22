export class LoansError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export class LoansConfigurationError extends LoansError {
  constructor(source: string) { super(503, "loans_configuration", source === "session affinity" ? "Loans requires a direct or session-pooled database connection and explicit session-affinity acknowledgement." : "Loans configuration or schema is not ready."); }
}
export function loansFailure(error: unknown): Response {
  if (error && typeof error === "object" && "code" in error && ["42703", "42P01", "42501"].includes(String(error.code))) error = new LoansConfigurationError("schema");
  if (error instanceof LoansError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  return Response.json({ error: "Loans is unavailable. Verify the return state before retrying.", code: "loans_unavailable" }, { status: 503 });
}
export const uncertain = () => new LoansError(503, "return_state_uncertain", "The return result needs verification. Retry the same return information or ask staff to reconcile it.");
export const handoverUncertain = () => new LoansError(503, "handover_state_uncertain", "The handover result needs verification. Retry the same handover information or ask staff to reconcile it.");
