import { forwardEquipment } from "@/lib/gateway/equipment";
export function GET(request: Request) {
  return forwardEquipment(request, "/categories" + (request.method === "GET" ? new URL(request.url).search : ""));
}
export function POST(request: Request) {
  return forwardEquipment(request, "/categories" + (request.method === "GET" ? new URL(request.url).search : ""));
}
