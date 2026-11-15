import { forwardEquipment } from "@/lib/gateway/equipment";
import { catalogue } from "@/lib/gateway/catalogue";
export function GET(request: Request) {
  return catalogue(request);
}
export function POST(request: Request) {
  return forwardEquipment(request, "/items" + (request.method === "GET" ? new URL(request.url).search : ""));
}
