
import { forwardEquipment } from "@/lib/gateway/equipment";

// GET /api/items/lookup?q=FPGA-003
export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const identifier = searchParams.get("q") ?? "";

  return forwardEquipment(
    request,
    "/items/lookup?q=" + encodeURIComponent(identifier)
  );
}
