// What the sign-in page and the account pages say for each outcome of a Google round trip. The OAuth callback
// redirects with one of these codes (?error=<code>), never with free text, so an address can't put arbitrary words
// on the sign-in page. Client-safe (no server imports).

export const AUTH_ERRORS: Record<string, string> = {
  unverified: "Google hasn't verified this account's email address.",
  "shared-account":
    "This is a shared analytics account. It can be connected as a data source (Account → Data connections) but can't be used to sign in. Sign in with your own company account.",
  "not-eligible": "SEO Console is available to Artemis Digital and Heads on Pillows company accounts. Sign in with your company Google account.",
  "domain-mismatch": "Google didn't confirm this account belongs to the company's Google Workspace. Sign in with your company Google account.",
  "bad-token": "Google's sign-in response couldn't be verified. Try again.",
  disabled: "This profile is disabled. Ask the operator.",
  conflict: "This address already belongs to another SEO Console record. Ask the operator to review it.",
  "link-conflict":
    "This Google account belongs to a record that can't be linked here (for example a shared analytics account or a disabled profile). Ask the operator to review it.",
  "connect-not-eligible": "Only the shared analytics accounts or a team member's own eligible Google account can be connected as a data source.",
  "no-refresh-token": "Google didn't return lasting access. Connect again and allow every requested permission.",
  expired: "This sign-in link expired or wasn't started here. Try again.",
  "session-changed": "Your session changed during the Google sign-in. Sign in and try again.",
  cancelled: "Google sign-in was cancelled.",
  failed: "Sign-in didn't complete. Please try again.",
  // Earlier codes, kept for old links.
  not_allowed: "SEO Console is available to Artemis Digital and Heads on Pillows company accounts. Sign in with your company Google account.",
  access_denied: "Google sign-in was cancelled.",
};

export const authErrorMessage = (code: string | null | undefined): string | null => (code ? (AUTH_ERRORS[code] ?? AUTH_ERRORS.failed) : null);
