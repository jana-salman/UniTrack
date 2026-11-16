
import { NextResponse } from "next/server";
import { requireRole } from "../../../lib/auth/authorization";
import { findItemByIdentifier } from "../../../lib/item-lookups";
import { lookupError } from "../../../lib/http";

// GET /items/lookup?q=FPGA-003
export async function GET(request: Request) {
  try {
    // Only lab assistants and lab managers can look up equipment.
    const user = await requireRole(request, [
      "lab_assistant",
      "lab_manager",
    ]);

    const { searchParams } = new URL(request.url);
    const identifier = (searchParams.get("q") ?? "").trim();

    // Validate the search input.
    if (!identifier || identifier.length > 100) {
      return NextResponse.json(
        { error: "Enter a valid equipment identifier (maximum 100 characters)." },
        { status: 400 }
      );
    }

    // Search only within the authenticated user's lab.
    const item = await findItemByIdentifier(
      identifier,
      user.lab_id
    );

    if (!item) {
      return NextResponse.json(
        { error: "Equipment not found or access denied." },
        { status: 404 }
      );
    }

    return NextResponse.json(item);
  } catch (error) {
    return lookupError(error);
  }
}
