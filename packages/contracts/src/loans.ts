export interface LoanDueDate {
  itemId: string;
  dueDate: string;
}

export interface Reservation {
  id: string;
  item_id: string;
  borrower_id: string;
  lab_id: number;
  start_at: string;
  end_at: string;
  status: "confirmed";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isReservation(value: unknown): value is Reservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && UUID.test(row.id)
    && typeof row.item_id === "string" && UUID.test(row.item_id)
    && typeof row.borrower_id === "string" && UUID.test(row.borrower_id)
    && Number.isSafeInteger(row.lab_id) && (row.lab_id as number) > 0
    && typeof row.start_at === "string" && Number.isFinite(Date.parse(row.start_at))
    && typeof row.end_at === "string" && Number.isFinite(Date.parse(row.end_at))
    && Date.parse(row.end_at as string) > Date.parse(row.start_at as string)
    && row.status === "confirmed";
}

export function isLoanDueDate(value: unknown): value is LoanDueDate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const dueDate = value as Record<string, unknown>;
  return typeof dueDate.itemId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dueDate.itemId)
    && typeof dueDate.dueDate === "string"
    && Number.isFinite(Date.parse(dueDate.dueDate));
}

import { HANDOVER_ERROR_CODES, HANDOVER_ERROR_MESSAGES } from "./handover.js";

// Approved wire vocabulary only. No persistence or business implementation.
export const LOANS_ERROR_CONTRACT = {
  messages: [
    "Sign in is required.", "Permission denied.", "Invalid loan ID.", "Loan not found.",
    "Invalid return information. Check every condition.", "Equipment item not found.",
    "Only borrowed or overdue items can be returned.", "This loan has already been returned.",
    "A return is already in progress. Retry the same information later.",
    "Choose an item and valid start and end dates.", "Choose a valid equipment item or kit.",
    "Choose valid start and end dates.", "The end date must be after the start date.",
    "The start date cannot be in the past.", "Reservations can be no longer than 7 days.",
    "Reservations can start no more than 14 days in advance.",
    "This item requires approval and cannot currently be reserved through UniTrack.",
    "Equipment item not found.", "This item is not available in your laboratory.",
    "This item is not currently available for reservation.",
    "A tracked component of this kit is not currently available for reservation.",
    "This item or one of its tracked kit components is already reserved for part of those dates.",
    "Equipment is unavailable for reservation. Try again.", "Reservation could not be saved. Try again.",
    "Return information or confirming user differs from the recorded attempt.",
    "The pickup condition records are missing.", "A checked component is not in the pickup record.",
    "A component was checked more than once.", "The main item was checked more than once.",
    "Record the main item's return condition.", "Check every component from the pickup record.",
    "Equipment rejected the return operation. Verify its status before retrying.",
    "The return result needs verification. Retry the same return information or ask staff to reconcile it.",
    "Return records were not saved. Equipment was restored. Retry the same return information.",
    "Loans configuration or schema is not ready.",
    "Loans requires a direct or session-pooled database connection and explicit session-affinity acknowledgement.",
    "Loans is unavailable. Verify the return state before retrying.",
    "Invalid item IDs. Maximum batch size is 100.",
    ...HANDOVER_ERROR_MESSAGES,
  ],
  codes: ["unauthenticated", "forbidden", "invalid_loan", "loan_not_found", "invalid_return", "equipment_missing", "return_conflict", "equipment_rejected", "return_state_uncertain", "return_rolled_back", "loans_configuration", "loans_unavailable", "invalid_items", "invalid_reservation", "restricted_equipment", "incorrect_lab", "equipment_unavailable", "reservation_conflict", "reservation_equipment_unavailable", "reservation_unavailable", ...HANDOVER_ERROR_CODES],
} as const;
