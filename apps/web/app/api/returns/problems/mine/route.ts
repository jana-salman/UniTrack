import { forwardReturnProblems } from "@/lib/gateway/return-problems";
export function GET(request: Request) { return forwardReturnProblems(request); }
