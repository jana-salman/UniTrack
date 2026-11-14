import { equipmentFailure } from "../../../lib/service-errors";
import { NextResponse } from "next/server";
import { requireRole } from "../../../lib/auth/authorization";
import { AuthorizationError } from "../../../lib/auth/errors";
import { getDatabasePool } from "../../../lib/db";
import { listEquipment } from "../../../lib/equipment-queries";

export async function GET(request: Request) {

  try {
    // Only Lab Managers can access this endpoint.
    const manager = await requireRole(request, ["lab_manager"]);

    if (manager.lab_id === null) {
      return NextResponse.json(
        { error: "Manager is not assigned to a laboratory." },
        { status: 403 }
      );
    }

    // Retrieve equipment belonging to the manager's laboratory.
    const equipment = await listEquipment(
      getDatabasePool(),
      manager.lab_id
    );

    return NextResponse.json(equipment, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const unavailable = equipmentFailure(error);
    if (unavailable) return unavailable;
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: "Unable to retrieve equipment." },
      { status: 500 }
    );
  }
}