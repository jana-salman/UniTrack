export const PROFILE_ROLES = [
  "student",
  "lab_assistant",
  "professor",
  "lab_manager",
] as const;

export type ProfileRole = (typeof PROFILE_ROLES)[number];

export type Profile = {
  id: string;
  full_name: string;
  university_email: string;
  role: ProfileRole;
  lab_id: number;
  is_active: boolean;
};

export function isProfileRole(value: unknown): value is ProfileRole {
  return (
    typeof value === "string" &&
    PROFILE_ROLES.includes(value as ProfileRole)
  );
}

export function roleLabel(role: ProfileRole): string {
  return {
    student: "Student",
    lab_assistant: "Lab Assistant",
    professor: "Professor",
    lab_manager: "Lab Manager",
  }[role];
}
