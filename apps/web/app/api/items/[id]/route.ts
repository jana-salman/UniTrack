import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/errors";
import { getDatabasePool } from "@/lib/db";
import {
  updateEquipment,
  type UpdateEquipmentInput,
} from "@/lib/equipment-queries";
import { validateUpdateEquipmentInput } from "@/lib/equipment-validation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// PATCH /api/items/[id]
// Allows Lab Managers to edit equipment in their own laboratory.
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/items/[id]">
) {
  try {
    // Only Lab Managers can edit equipment.
    const manager = await requireRole(["lab_manager"]);

    if (manager.lab_id === null) {
      return NextResponse.json(
        { error: "Manager is not assigned to a laboratory." },
        { status: 403 }
      );
    }

    // Get the equipment UUID from the URL.
    const { id } = await context.params;

    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json(
        { error: "Invalid equipment ID." },
        { status: 400 }
      );
    }

    // Read the request body.
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    // Validate the equipment information.
    const errors = validateUpdateEquipmentInput(body);

    if (errors.length > 0) {
      return NextResponse.json(
        { error: errors.join(" "), errors },
        { status: 400 }
      );
    }

    // Update only equipment belonging to the manager's lab.
    const updated = await updateEquipment(
      getDatabasePool(),
      id,
      manager.lab_id,
      body as UpdateEquipmentInput
    );

    if (!updated) {
      return NextResponse.json(
        { error: "Equipment not found or access denied." },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    // Invalid category reference.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23503"
    ) {
      return NextResponse.json(
        { error: "Invalid category ID." },
        { status: 400 }
      );
    }

    console.error("PATCH /api/items/[id] failed", error);

    return NextResponse.json(
      { error: "Could not update equipment." },
      { status: 500 }
    );
  }
}