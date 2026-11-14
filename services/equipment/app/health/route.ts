import type { HealthResponse } from "@unitrack/contracts";
import { version } from "../../package.json";

// Public process health only. No configuration, database or downstream calls.
export function GET() {
  return Response.json({ service: "equipment", status: "ok", version } satisfies HealthResponse, {
    headers: { "Cache-Control": "no-store" },
  });
}
