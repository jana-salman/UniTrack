import { NextResponse } from "next/server";
import { getCatalogue } from "@/lib/catalogue-query";

// GET /api/items?search=drone&category=Drones
// Returns the active items for the student catalogue.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = (searchParams.get("search") ?? "").trim();
  const category = (searchParams.get("category") ?? "").trim();

  // TODO (NH): when login is ready, refuse the request if nobody is signed in.

  try {
    const items = await getCatalogue(search, category);
    return NextResponse.json(items);
  } catch (error) {
    console.error("GET /api/items failed", error);
    return NextResponse.json(
      { error: "Could not load the catalogue" },
      { status: 500 }
    );
  }
}