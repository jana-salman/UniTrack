import { forwardHandover } from "@/lib/gateway/handover";
// Unfinished handovers in the signed-in assistant's lab.
export async function GET(request: Request) { return forwardHandover(request, null, "interrupted"); }
