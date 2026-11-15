import { isProfileRole, type ProfileRole } from "./index.js";
export interface UserProfile {
  id: string; full_name: string; university_email: string; role: ProfileRole; lab_id: number; is_active: boolean;
}
export interface ProfileName { id: string; full_name: string }
export function isProfileId(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function isUserProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return isProfileId(p.id) && typeof p.full_name === "string" && typeof p.university_email === "string" &&
    isProfileRole(p.role) && typeof p.lab_id === "number" && Number.isSafeInteger(p.lab_id) && p.lab_id > 0 && typeof p.is_active === "boolean";
}
export function isProfileName(value: unknown): value is ProfileName {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return isProfileId(profile.id) && typeof profile.full_name === "string";
}
export const USERS_ERROR_CONTRACT = {
  messages: ["Sign in is required.", "You do not have permission to perform this action.", "Invalid user id.",
    "role must be a supported profile role.", "User was not found in your laboratory.", "Unable to update the role.",
    "User profile not found.", "Invalid laboratory ID.", "Laboratory access denied.", "Invalid profile IDs. Maximum batch size is 100.",
    "Users service is not configured.", "Users database schema is not ready.", "Users database access is unavailable.", "Unable to retrieve profiles."],
  codes: ["unauthenticated", "insufficient_role", "users_not_configured", "users_schema_not_ready", "users_database_unavailable", "users_unavailable"],
} as const;
