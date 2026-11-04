import { NextResponse } from "next/server";
import { getCatalogue } from "@/lib/catalogue-query";
import { requireRole } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/errors";

// GET /api/items?search=drone&category=Drones
// Returns the active items of the signed-in user's lab.
// Any of the four roles may read the catalogue.
const CATALOGUE_ROLES = [
  "student",
  "lab_assistant",
  "professor",
  "lab_manager",
] as const;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = (searchParams.get("search") ?? "").trim();
  const category = (searchParams.get("category") ?? "").trim();

  try {
    const user = await requireRole(CATALOGUE_ROLES);
    const items = await getCatalogue(search, category, user.lab_id);
    return NextResponse.json(items);
  } catch (error) {
    // 401 = not signed in, 403 = wrong role (from NH's helpers)
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("GET /api/items failed", error);
    return NextResponse.json(
      { error: "Could not load the catalogue" },
      { status: 500 }
    );
  }
}