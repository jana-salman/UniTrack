import { isUniversityEmail, normalizeEmail } from "./email";
import type { Profile } from "./model";

type LoginUser = { id: string; email?: string };

export type LoginDependencies = {
  signIn: (email: string, password: string) => Promise<LoginUser | null>;
  signOut: () => Promise<void>;
  findProfile: (userId: string) => Promise<Profile | null>;
};

type LoginErrorCode =
  | "configuration_error"
  | "invalid_email_domain"
  | "invalid_credentials"
  | "inactive_profile"
  | "missing_profile"
  | "service_unavailable";

export type LoginResult =
  | { ok: true }
  | { ok: false; code: LoginErrorCode; message: string };

export async function authenticateWithPassword(
  email: string,
  password: string,
  allowedDomains: readonly string[],
  dependencies: LoginDependencies,
): Promise<LoginResult> {
  const normalizedEmail = normalizeEmail(email);

  if (allowedDomains.length === 0) {
    return failure(
      "configuration_error",
      "University login is not configured. Contact an administrator.",
    );
  }

  if (!isUniversityEmail(normalizedEmail, allowedDomains)) {
    return failure(
      "invalid_email_domain",
      "Use an approved university email address.",
    );
  }

  if (!password) {
    return invalidCredentials();
  }

  let user: LoginUser | null;
  try {
    user = await dependencies.signIn(normalizedEmail, password);
  } catch (error) {
     logLoginError("signIn", error);
     return unavailable();
  }

  if (!user) {
    return invalidCredentials();
  }

  let profile: Profile | null;
  try {
    profile = await dependencies.findProfile(user.id);
  } catch (error) {
     logLoginError("signIn", error);
     return unavailable();
  }

  const authenticatedEmail = normalizeEmail(user.email ?? "");
  if (
    !profile ||
    authenticatedEmail !== normalizedEmail ||
    normalizeEmail(profile.university_email) !== authenticatedEmail
  ) {
    await dependencies.signOut();
    return failure(
      "missing_profile",
      "This account is not provisioned for UniTrack.",
    );
  }

  if (!profile.is_active) {
    await dependencies.signOut();
    return failure("inactive_profile", "This UniTrack account is inactive.");
  }

  return { ok: true };
}

function failure(code: LoginErrorCode, message: string): LoginResult {
  return { ok: false, code, message };
}

function invalidCredentials(): LoginResult {
  return failure("invalid_credentials", "Incorrect email or password.");
}

function unavailable(): LoginResult {
  return failure(
    "service_unavailable",
    "University login is temporarily unavailable. Try again later.",
  );
}

  function logLoginError(step: "signIn" | "findProfile", error: unknown) {
    const details = error as {
      name?: string;
      message?: string;
      code?: string;
    } | null;

    console.error(`login: ${step} failed`, {
      name: details?.name,
      code: details?.code,
      message: details?.message,
    });
  }