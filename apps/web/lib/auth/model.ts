import type { ProfileRole } from "@unitrack/contracts";
export { PROFILE_ROLES, isProfileRole } from "@unitrack/contracts";
export type { ProfileRole, UserProfile as Profile } from "@unitrack/contracts";

export function roleLabel(role: ProfileRole): string {
  return {
    student: "Student",
    lab_assistant: "Lab Assistant",
    professor: "Professor",
    lab_manager: "Lab Manager",
  }[role];
}
