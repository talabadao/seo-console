// Who may use SEO Console, decided on Google's verified identity (ID token claims), never on a client-supplied
// email or an authorization-URL hint. One team workspace (docs/seo-console-v2/WORKSPACE-MEMBERS.md):
// - Personal sign-in / linking: a Google Workspace account at exactly one of the company domains, with Google's
//   hosted-domain claim (hd) equal to that domain, or the one named personal exception. Any other Gmail account,
//   look-alike domain or sub-domain is refused. The two shared analytics accounts are never personal logins.
// - Google data connection: the two shared analytics accounts, or an identity that may sign in personally.

export const COMPANY_DOMAINS: readonly string[] = ["artemisdigital.com", "headsonpillows.com"];
export const PERSONAL_EXCEPTIONS: readonly string[] = ["tinledoihoa@gmail.com"];
export const SHARED_CONNECTION_ACCOUNTS: readonly string[] = ["analytics@artemisdigital.com", "analytics@headsonpillows.com"];

/** Google's two documented issuer spellings; stored in one form so (issuer, subject) is stable. */
export const GOOGLE_ISSUER = "https://accounts.google.com";
export function normalizeIssuer(iss: string | null | undefined): string | null {
  if (iss === "https://accounts.google.com" || iss === "accounts.google.com") return GOOGLE_ISSUER;
  return null;
}

/** Surrounding whitespace and letter case are ignored; nothing else (dots, +tags) is rewritten. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface GoogleClaims {
  iss?: string | null;
  sub?: string | null;
  email?: string | null;
  email_verified?: boolean | null;
  hd?: string | null;
  name?: string | null;
  picture?: string | null;
}

export type IneligibleReason = "unverified" | "shared-account" | "not-eligible" | "domain-mismatch" | "bad-token";

export interface VerifiedIdentity {
  issuer: string;
  subject: string;
  email: string;
  hostedDomain: string | null;
  name: string | null;
  picture: string | null;
}

function basic(claims: GoogleClaims | null | undefined): VerifiedIdentity | IneligibleReason {
  if (!claims) return "bad-token";
  const issuer = normalizeIssuer(claims.iss);
  if (!issuer || !claims.sub || typeof claims.email !== "string") return "bad-token";
  if (claims.email_verified !== true) return "unverified";
  return {
    issuer,
    subject: String(claims.sub),
    email: normalizeEmail(claims.email),
    hostedDomain: claims.hd ? String(claims.hd).toLowerCase() : null,
    name: claims.name ?? null,
    picture: claims.picture ?? null,
  };
}

const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1);

/** The company domain of an eligible company identity (exact domain AND matching hosted-domain claim), else null. */
export function companyDomainOf(identity: Pick<VerifiedIdentity, "email" | "hostedDomain">): string | null {
  const domain = domainOf(identity.email);
  return COMPANY_DOMAINS.includes(domain) && identity.hostedDomain === domain ? domain : null;
}

/** Whether a verified identity may sign in (or be linked) as a person. */
export function personalEligibility(claims: GoogleClaims | null | undefined): { ok: true; identity: VerifiedIdentity } | { ok: false; reason: IneligibleReason } {
  const id = basic(claims);
  if (typeof id === "string") return { ok: false, reason: id };
  if (SHARED_CONNECTION_ACCOUNTS.includes(id.email)) return { ok: false, reason: "shared-account" };
  if (PERSONAL_EXCEPTIONS.includes(id.email)) return id.hostedDomain ? { ok: false, reason: "domain-mismatch" } : { ok: true, identity: id };
  if (COMPANY_DOMAINS.includes(domainOf(id.email))) return companyDomainOf(id) ? { ok: true, identity: id } : { ok: false, reason: "domain-mismatch" };
  return { ok: false, reason: "not-eligible" };
}

/** Whether a stored identity still qualifies (rechecked on every request, so a narrowed rule takes effect at once). */
export function storedIdentityEligible(identity: { email: string; hosted_domain: string | null }): boolean {
  return personalEligibility({ iss: GOOGLE_ISSUER, sub: "stored", email: identity.email, email_verified: true, hd: identity.hosted_domain }).ok;
}

/** Whether a verified identity may be connected as a shared Google data source. */
export function connectionEligibility(claims: GoogleClaims | null | undefined): { ok: true; identity: VerifiedIdentity; shared: boolean } | { ok: false; reason: IneligibleReason } {
  const id = basic(claims);
  if (typeof id === "string") return { ok: false, reason: id };
  if (SHARED_CONNECTION_ACCOUNTS.includes(id.email)) {
    // The analytics accounts are company Workspace accounts: their hosted domain must match too.
    return id.hostedDomain === domainOf(id.email) ? { ok: true, identity: id, shared: true } : { ok: false, reason: "domain-mismatch" };
  }
  const personal = personalEligibility(claims);
  return personal.ok ? { ok: true, identity: personal.identity, shared: false } : personal;
}

export const INELIGIBLE_MESSAGE: Record<IneligibleReason, string> = {
  unverified: "Google hasn't verified this account's email address.",
  "shared-account": "This is a shared analytics account. It can be connected as a data source (Account → Data connections) but can't be used to sign in. Sign in with your own company account.",
  "not-eligible": "SEO Console is available to Artemis Digital and Heads on Pillows company accounts. Sign in with your company Google account.",
  "domain-mismatch": "Google didn't confirm this account belongs to the company's Google Workspace. Sign in with your company Google account.",
  "bad-token": "Google's sign-in response couldn't be verified. Try again.",
};
