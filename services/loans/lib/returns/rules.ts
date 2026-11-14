import type { ReturnLoan } from "./types";

export type ReturnStatus =
  | "available"
  | "reserved"
  | "inspection_required";

export function determineReturnOutcome(
  loan: ReturnLoan,
  returnedAt: Date,
  hasProblem: boolean,
  hasActivePickup: boolean,
): {
  status: ReturnStatus;
  isLate: boolean;
} {
  if (loan.returned_at !== null) {
    throw new Error("This loan has already been returned.");
  }

  const returnTime = returnedAt.getTime();
  const borrowedTime = loan.borrowed_at.getTime();
  const dueTime = loan.due_date.getTime();

  if (
    !Number.isFinite(returnTime) ||
    !Number.isFinite(borrowedTime) ||
    !Number.isFinite(dueTime)
  ) {
    throw new Error("Invalid loan or return date.");
  }

  if (returnTime < borrowedTime) {
    throw new Error("The return cannot be before the handover.");
  }

  let status: ReturnStatus = "available";

  if (hasProblem) {
    status = "inspection_required";
  } else if (hasActivePickup) {
    status = "reserved";
  }

  return {
    status,
    isLate: returnTime > dueTime,
  };
}