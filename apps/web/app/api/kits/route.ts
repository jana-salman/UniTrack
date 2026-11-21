import { forwardEquipment } from "@/lib/gateway/equipment";

export function GET(request: Request) {
  return forwardEquipment(request, "/kits");
}
export function POST(request: Request) {
  return forwardEquipment(request, "/kits");
}
