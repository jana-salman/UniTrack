import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getActiveCategories } from "@/lib/category-queries";

// GET /api/categories
// Returns active equipment categories.

export async function GET() {
  try {
    const categories = await getActiveCategories(pool);

    return NextResponse.json(categories);

  } catch (error) {
    console.error("GET /api/categories failed:", error);

    return NextResponse.json(
      { error: "Could not load categories" },
      { status: 500 }
    );
  }
}