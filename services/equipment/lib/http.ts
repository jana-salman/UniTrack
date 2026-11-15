import { equipmentFailure } from "./service-errors";
import { NextResponse } from "next/server";
import { AuthorizationError } from "./auth/errors";
export function lookupError(error: unknown) {
  const unavailable = equipmentFailure(error);
  if (unavailable) return unavailable;
  if (error instanceof AuthorizationError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  return NextResponse.json({ error: "Unable to retrieve equipment." }, { status: 500 });
}
