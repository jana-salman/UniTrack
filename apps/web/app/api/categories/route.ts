import { NextResponse } from "next/server";
import { connection } from "next/server";
import { pool } from "@/lib/db";

import {
  getActiveCategories,
  createCategory,
  type CreateCategoryInput,
} from "@/lib/category-queries";

import { validateCreateCategoryInput } from "@/lib/category-validation";

import { requireRole } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/errors";

// GET /api/categories
// Returns active equipment categories.

export async function GET() {
  try {
    await connection();
    await requireRole(["student", "lab_assistant", "professor", "lab_manager"]);

    const categories = await getActiveCategories(pool);

    return NextResponse.json(categories);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error("GET /api/categories failed:", error);

    return NextResponse.json(
      { error: "Could not load categories" },
      { status: 500 }
    );
  }
}

// POST /api/categories
// Allows Lab Managers to create equipment categories.

export async function POST(request: Request) {
  try {
    // Step 1: Verify that the user is an authenticated Lab Manager.
    await requireRole(["lab_manager"]);

    // Step 2: Read the JSON request body.
    const body: unknown = await request.json().catch(() => null);

    // Step 3: Validate the category data.
    const errors = validateCreateCategoryInput(body);

    if (errors.length > 0) {
      return NextResponse.json(
        { errors },
        { status: 400 }
      );
    }

    // Validation ensures the required fields have valid types.
    const categoryInput = body as CreateCategoryInput;

    // Step 4: Insert the category into PostgreSQL.
    const category = await createCategory(pool, categoryInput);

    if (!category) {
      throw new Error("Category creation returned no record.");
    }

    // Step 5: Return the newly created category.
    return NextResponse.json(category, { status: 201 });

  } catch (error) {
    // Authentication and authorization errors.
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    // PostgreSQL error 23505: unique constraint violation.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return NextResponse.json(
        { error: "A category with this name already exists." },
        { status: 409 }
      );
    }

    console.error("POST /api/categories failed:", error);

    return NextResponse.json(
      { error: "Could not create category." },
      { status: 500 }
    );
  }
}