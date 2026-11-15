import { forwardEquipment } from "@/lib/gateway/equipment";
export function GET(request: Request) {
  return forwardEquipment(request, "/manager/equipment" + (request.method === "GET" ? new URL(request.url).search : ""));
}
