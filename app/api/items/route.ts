import { NextResponse } from "next/server";
import { getCatalogue } from "@/lib/catalogue-query";
import { requireRole } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/errors";

import { pool } from "@/lib/db";
import { createEquipment } from "@/lib/equipment-queries";
import {
  validateCreateEquipmentInput,
  type CreateEquipmentInput,
} from "@/lib/equipment-validation";

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

// POST /api/items
// Allows a Lab Manager to create equipment in their own laboratory.

export async function POST(request: Request) {
  try {
    // Only Lab Managers can create equipment.
    const manager = await requireRole(["lab_manager"]);

    if (
      typeof manager.lab_id !== "number" ||
      !Number.isInteger(manager.lab_id) ||
      manager.lab_id <= 0
    ) {
      return NextResponse.json(
        { error: "Manager is not assigned to a valid laboratory." },
        { status: 403 }
      );
    }

    // Read the submitted equipment data.
    const body: unknown = await request.json().catch(() => null);

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Equipment data must be an object." },
        { status: 400 }
      );
    }

    const submitted = body as Record<string, unknown>;

    // Never trust the laboratory ID provided by the browser.
    // Use the authenticated manager's laboratory.
    const equipment = {
      ...submitted,
      lab_id: manager.lab_id,
      condition: submitted.condition ?? "unknown",
      is_restricted: submitted.is_restricted ?? false,
    };

    // Validate the equipment information.
    const errors = validateCreateEquipmentInput(equipment);

    if (errors.length > 0) {
      return NextResponse.json(
        { error: "Invalid equipment data.", errors },
        { status: 400 }
      );
    }

    // Save the equipment in PostgreSQL.
    const created = await createEquipment(
      pool,
      equipment as CreateEquipmentInput,
      manager.id
    );

    if (!created) {
      throw new Error("Database did not return the created equipment.");
    }

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    // Handle authentication and authorization errors.
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    // Handle PostgreSQL constraint violations.
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;

    if (code === "23505") {
      return NextResponse.json(
        { error: "An equipment item with this asset code already exists." },
        { status: 409 }
      );
    }

    if (code === "23503") {
      return NextResponse.json(
        { error: "Invalid category or related database record." },
        { status: 400 }
      );
    }

    console.error("POST /api/items failed:", error);

    return NextResponse.json(
      { error: "Could not create equipment." },
      { status: 500 }
    );
  }
}