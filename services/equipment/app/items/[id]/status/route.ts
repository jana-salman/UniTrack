import { equipmentFailure } from "../../../../lib/service-errors";

import { NextResponse } from "next/server";
import { requireRole } from "../../../../lib/auth/authorization";
import { AuthorizationError } from "../../../../lib/auth/errors";
import { getDatabasePool } from "../../../../lib/db";
import { updateEquipmentStatus, normalizeStatusOptions, EquipmentStatusConflictError, IdempotencyKeyConflictError } from "../../../../lib/equipment-status-transaction";
import { validateStatusChange } from "../../../../lib/equipment-status-change";

export async function PATCH(
  request: Request,
  context: RouteContext<"/items/[id]/status">
) {
  try {
    const user = await requireRole(request, ["lab_manager", "lab_assistant"]);
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

    const { status, reason, expectedStatus } = body as Record<string, unknown>;

    if (
      typeof status !== "string" ||
      (reason !== undefined && typeof reason !== "string")
    ) {
      return NextResponse.json(
        { error: "Invalid status or reason" },
        { status: 400 }
      );
    }


    validateStatusChange(id, status, reason);
    const options = { expectedStatus: expectedStatus as string | string[] | undefined, idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined };
    normalizeStatusOptions(options);

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
        reason,
        options
      );

      return NextResponse.json(result);
    } finally {
      client.release();
    }
  } catch (error) {
    const unavailable = equipmentFailure(error);
    if (unavailable) return unavailable;
    if (error instanceof EquipmentStatusConflictError || error instanceof IdempotencyKeyConflictError) {
      return NextResponse.json({ error: error.message, code: error instanceof EquipmentStatusConflictError ? "equipment_status_conflict" : "idempotency_key_conflict" }, { status: 409 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    if (error instanceof Error) {
      if (
        error.message === "Invalid expectedStatus" || error.message === "Invalid idempotency key" ||
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

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
