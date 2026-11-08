import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/errors";
import { getReturnDetails } from "@/lib/returns/queries";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: RouteContext<"/api/returns/[loanId]">,
) {
  try {
    const user = await requireRole(["lab_assistant"]);

    if (
      user.lab_id === null ||
      !Number.isInteger(user.lab_id) ||
      user.lab_id <= 0
    ) {
      return NextResponse.json(
        { error: "User is not assigned to a laboratory." },
        { status: 403 },
      );
    }

    const { loanId } = await context.params;

    if (!uuidPattern.test(loanId)) {
      return NextResponse.json(
        { error: "Invalid loan ID." },
        { status: 400 },
      );
    }

    const details = await getReturnDetails(loanId, user.lab_id);

    if (!details) {
      return NextResponse.json(
        { error: "Loan not found." },
        { status: 404 },
      );
    }

    return NextResponse.json(details, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    console.error("Loading return details failed", error);

    return NextResponse.json(
      { error: "Unable to load return details." },
      { status: 500 },
    );
  }
}