import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/errors";
import { getReturnDetails } from "@/lib/returns/queries";
import { returnEquipmentClient } from "@/lib/clients/return-equipment-client";
import { EquipmentStatusConflictError } from "@/lib/equipment-status-transaction";
import { confirmReturn } from "@/lib/returns/service";
import { ReturnTransactionError } from "@/lib/returns/transaction";
import { validateReturnInput } from "@/lib/returns/validation";

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

export async function POST(
  request: Request,
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

    const origin = request.headers.get("origin");

    if (origin && origin !== new URL(request.url).origin) {
      return NextResponse.json(
        { error: "Request origin is not permitted." },
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

    let input;

    try {
      input = validateReturnInput(await request.json());
    } catch {
      return NextResponse.json(
        { error: "Invalid return information. Check every condition." },
        { status: 400 },
      );
    }

    const result = await confirmReturn(
      loanId,
      input,
      {
        id: user.id,
        role: user.role,
        labId: user.lab_id,
      },
      returnEquipmentClient,
    );

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    if (
      error instanceof ReturnTransactionError &&
      error.commitAttempted
    ) {
      return NextResponse.json(
        {
          error: error.message,
          code: "return_state_uncertain",
        },
        { status: 503 },
      );
    }

    const cause =
      error instanceof ReturnTransactionError
        ? error.originalError
        : error;

    if (cause instanceof EquipmentStatusConflictError) {
      return NextResponse.json(
        { error: cause.message, code: "equipment_status_conflict" },
        { status: 409 },
      );
    }

    if (cause instanceof Error) {
      if (
        cause.message === "Loan not found." ||
        cause.message === "Equipment item not found."
      ) {
        return NextResponse.json(
          { error: "Loan or equipment not found." },
          { status: 404 },
        );
      }

      const conflictMessages = [
        "This loan has already been returned.",
        "Only borrowed or overdue items can be returned.",
        "The pickup condition records are missing.",
        "A checked component is not in the pickup record.",
        "A component was checked more than once.",
        "The main item was checked more than once.",
        "Record the main item's return condition.",
        "Check every component from the pickup record.",
      ];

      if (conflictMessages.includes(cause.message)) {
        return NextResponse.json(
          { error: cause.message },
          { status: 409 },
        );
      }
    }

    console.error("Return confirmation failed", error);

    return NextResponse.json(
      {
        error:
          "Return confirmation failed. Check the loan and equipment status before retrying.",
      },
      { status: 500 },
    );
  }
}