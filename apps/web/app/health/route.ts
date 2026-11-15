import type { HealthResponse } from "@unitrack/contracts";
import { version } from "../../package.json";

// Public process health only. No authentication, configuration, or downstream calls.
export function GET() {
  return Response.json(
    { service: "web", status: "ok", version } satisfies HealthResponse,
    { headers: { "Cache-Control": "no-store" } },
  );
}
