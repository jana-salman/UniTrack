
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
}

export function getAllowedEmailDomains(): string[] {
  return (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map(normalizeDomain)
    .filter(Boolean);
}

export function isUniversityEmail(
  email: string,
  allowedDomains: readonly string[],
): boolean {
  const normalizedEmail = normalizeEmail(email);
  const parts = normalizedEmail.split("@");

  return (
    parts.length === 2 &&
    parts[0].length > 0 &&
    allowedDomains.includes(parts[1])
  );
}
