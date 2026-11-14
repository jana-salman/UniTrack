
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/errors";
import { getDatabasePool } from "@/lib/db";
import { updateEquipmentStatus } from "@/lib/equipment-status-transaction";
import { validateStatusChange } from "@/lib/equipment-status-change";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/items/[id]/status">
) {
  try {
    const { id } = await context.params;

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { status, reason } = body as Record<string, unknown>;

    if (
      typeof status !== "string" ||
      (reason !== undefined && typeof reason !== "string")
    ) {
      return NextResponse.json(
        { error: "Invalid status or reason" },
        { status: 400 }
      );
    }

    const user = await requireRole(["lab_manager", "lab_assistant"]);
    validateStatusChange(id, status, reason);

    if (status === "retired" && user.role !== "lab_manager") {
      return NextResponse.json(
        { error: "Only Lab Managers can retire equipment" },
        { status: 403 }
      );
    }

    if (user.lab_id === null) {
      return NextResponse.json(
        { error: "User is not assigned to a laboratory" },
        { status: 403 }
      );
    }

    const client = await getDatabasePool().connect();

    try {
      const result = await updateEquipmentStatus(
        client,
        id,
        status,
        user.id,
        user.lab_id,
        reason
      );

      return NextResponse.json(result);
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    if (error instanceof Error) {
      if (
        error.message === "Invalid equipment ID format" ||
        error.message === "Equipment ID cannot be empty" ||
        error.message === "Invalid equipment status"
      ) {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }

      if (error.message === "Equipment item not found or access denied") {
        return NextResponse.json(
          { error: error.message },
          { status: 404 }
        );
      }
    }

    console.error("Equipment status update failed", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
