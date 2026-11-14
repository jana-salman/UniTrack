import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { connection } from "next/server";

import { getAllowedEmailDomains, isUniversityEmail, normalizeEmail } from "./email";
import { AuthorizationError } from "./errors";
import type { Profile, ProfileRole } from "./model";
import { findProfileById } from "@/lib/profiles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const getAuthenticatedProfile = cache(async (): Promise<Profile> => {
  const supabase = await createSupabaseServerClient();
  const allowedDomains = getAllowedEmailDomains();
  if (allowedDomains.length === 0) {
    throw new AuthorizationError(
      503,
      "auth_not_configured",
      "University login is not configured.",
    );
  }

  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw new AuthorizationError(401, "unauthenticated", "Sign in is required.");
  }

  const email = normalizeEmail(data.user.email ?? "");
  if (!isUniversityEmail(email, allowedDomains)) {
    throw new AuthorizationError(
      403,
      "invalid_email_domain",
      "This account does not use the permitted university email domain.",
    );
  }

  const profile = await findProfileById(data.user.id);
  if (!profile || normalizeEmail(profile.university_email) !== email) {
    throw new AuthorizationError(
      403,
      "profile_not_found",
      "This account is not provisioned for UniTrack.",
    );
  }

  if (!profile.is_active) {
    throw new AuthorizationError(
      403,
      "profile_inactive",
      "This UniTrack account is inactive.",
    );
  }

  return profile;
});

export async function requireRole(
  allowedRoles: readonly ProfileRole[],
): Promise<Profile> {
  const profile = await getAuthenticatedProfile();

  if (!allowedRoles.includes(profile.role)) {
    throw new AuthorizationError(
      403,
      "insufficient_role",
      "You do not have permission to perform this action.",
    );
  }

  return profile;
}

export async function requirePageProfile(
  roles?: readonly ProfileRole[],
): Promise<Profile> {
  await connection();

  try {
    return roles ? await requireRole(roles) : await getAuthenticatedProfile();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.status === 401) {
        redirect("/login");
      }

      if (error.status === 403) {
        redirect("/unauthorized");
      }
    }

    throw error;
  }
}
