// Approved wire vocabulary only. No persistence or business implementation.
export const LOANS_ERROR_CONTRACT = {
  messages: [
    "Sign in is required.", "Permission denied.", "Invalid loan ID.", "Loan not found.",
    "Invalid return information. Check every condition.", "Equipment item not found.",
    "Only borrowed or overdue items can be returned.", "This loan has already been returned.",
    "A return is already in progress. Retry the same information later.",
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
  ],
  codes: ["unauthenticated", "forbidden", "invalid_loan", "loan_not_found", "invalid_return", "equipment_missing", "return_conflict", "equipment_rejected", "return_state_uncertain", "return_rolled_back", "loans_configuration", "loans_unavailable", "invalid_items"],
} as const;
