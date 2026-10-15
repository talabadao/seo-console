// Who may use SEO Console in phase 1: exactly these Google accounts (owner
// decision, 2026-10-15). This is an exact-address list, not a domain rule:
// other addresses at the same domains are refused. Checked on the server
// against Google's verified identity, both at sign-in and on every request.
// Each account keeps its own projects; being on this list grants no access to
// another account's data. Phase 2 replaces this with workspace membership.

export const ALLOWED_EMAILS: readonly string[] = [
  "analytics@headsonpillows.com",
  "analytics@artemisdigital.com",
];

const allowed = new Set(ALLOWED_EMAILS.map((e) => e.toLowerCase()));

/** Email addresses are compared case-insensitively; nothing else is normalised. */
export function isAllowedEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && allowed.has(email.trim().toLowerCase());
}

/**
 * Sign-in check on Google's verified ID-token claims: the address must be on
 * the list and Google must have verified that the account owns it.
 */
export function isAllowedIdentity(claims: { email?: string | null; email_verified?: boolean | null } | null | undefined): boolean {
  return Boolean(claims && claims.email_verified === true && isAllowedEmail(claims.email));
}
