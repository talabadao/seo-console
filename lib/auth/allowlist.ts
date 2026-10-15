// Who may use SEO Console in phase 1: exactly these Google accounts (owner
// decisions, 2026-10-15: the two analytics@ accounts, then three more added). This is an exact-address list, not a domain rule:
// other addresses at the same domains are refused. Checked on the server
// against Google's verified identity, both at sign-in and on every request.
// Each account keeps its own projects; being on this list grants no access to
// another account's data. Phase 2 replaces this with workspace membership.

export const ALLOWED_EMAILS: readonly string[] = [
  "analytics@headsonpillows.com",
  "analytics@artemisdigital.com",
  "tinledoihoa@gmail.com",
  "tin@headsonpillows.com",
  "tin@artemisdigital.com",
];

/** Surrounding whitespace and letter case are ignored; nothing else (dots, +tags) is rewritten. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const allowed = new Set(ALLOWED_EMAILS.map(normalizeEmail));

export function isAllowedEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && allowed.has(normalizeEmail(email));
}

/**
 * Sign-in check on Google's verified ID-token claims: the address must be on
 * the list and Google must have verified that the account owns it.
 */
export function isAllowedIdentity(claims: { email?: string | null; email_verified?: boolean | null } | null | undefined): boolean {
  return Boolean(claims && claims.email_verified === true && isAllowedEmail(claims.email));
}
