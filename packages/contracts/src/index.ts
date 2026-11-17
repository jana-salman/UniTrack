export interface ApiError { error: string; code?: string }
export interface HealthResponse { service: string; status: string; version: string }

// Matches the existing profile roles in apps/web/lib/auth/model.ts.
export const PROFILE_ROLES = ["student", "lab_assistant", "professor", "lab_manager"] as const;
export type ProfileRole = (typeof PROFILE_ROLES)[number];
export function isProfileRole(value: unknown): value is ProfileRole {
  return typeof value === "string" && PROFILE_ROLES.includes(value as ProfileRole);
}

export interface UserIdentity {
  kind: "user";
  sub: string;
  role: ProfileRole;
  lab_id: number;
  rid: string;
}
export interface ServiceIdentity {
  kind: "service";
  sub: "gateway";
  role: "service";
  lab_id: null;
  rid: string;
}
export type InternalIdentity = UserIdentity | ServiceIdentity;

export {
  EQUIPMENT_ERROR_CONTRACT,
  EQUIPMENT_STATUSES,
  isCatalogueItem,
  isEquipmentComponentSnapshot,
  isEquipmentItemSnapshot,
  isEquipmentStatus,
  isEquipmentStatusChangeResult,
} from "./equipment.js";
export type {
  CatalogueItem,
  EquipmentComponentSnapshot,
  EquipmentItemSnapshot,
  EquipmentStatus,
  EquipmentStatusChangeResult,
} from "./equipment.js";

export { isUserProfile, isProfileId, isProfileName, USERS_ERROR_CONTRACT } from "./users.js";
export type { UserProfile, ProfileName } from "./users.js";

export { isConditionStatus, isReturnDetails, isReturnOutcome, isReturnHistory, isOwnReturnProblem, isStudentReturnProblem } from "./returns.js";
export type { RecordedReturnCondition, ReturnHistory, ReturnProblemCondition, OwnReturnProblem, StudentReturnProblem } from "./returns.js";
export type { ConditionStatus, ReturnLoan, ReturnLoanWire, ReturnDetails, PickupCondition, ReturnConditionInput, ConfirmReturnInput, ReturnOutcome } from "./returns.js";

export { isLoanDueDate, LOANS_ERROR_CONTRACT } from "./loans.js";
export type { LoanDueDate } from "./loans.js";

export {
  HANDOVER_CONDITION_LABELS,
  HANDOVER_MAX_ROWS,
  HANDOVER_NOTES_MAX_LENGTH,
  isHandoverDetails,
  isHandoverOutcome,
} from "./handover.js";
export type {
  CompletedHandoverWire,
  ConfirmHandoverInput,
  HandoverConditionInput,
  HandoverDetails,
  HandoverOutcome,
  HandoverReservationWire,
} from "./handover.js";
