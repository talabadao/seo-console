// Which deployment this code is running in, and what that deployment may do.
//
// Preview deployments (every branch push) must never reach production data or
// act on the outside world: they get their own database through
// PREVIEW_DATABASE_URL, and writes to external services are off unless a
// preview is explicitly opened up with ALLOW_PREVIEW_EXTERNAL_WRITES=1.

type Env = Record<string, string | undefined>;

export type Deployment = "production" | "preview" | "development";

/** Vercel sets VERCEL_ENV; anything else (local `next dev`, scripts) is development. */
export function deploymentOf(env: Env = process.env): Deployment {
  return env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview" ? env.VERCEL_ENV : "development";
}

export class EnvironmentError extends Error {}

/**
 * The Postgres connection string for this deployment. In Preview only
 * PREVIEW_DATABASE_URL is used — the production variables (DATABASE_URL and
 * the Neon-provided POSTGRES_*) are ignored even when Vercel exposes them to
 * Preview, so a branch build can't touch production data by accident.
 */
export function databaseUrlFor(env: Env = process.env): string {
  if (deploymentOf(env) === "preview") {
    const url = env.PREVIEW_DATABASE_URL?.trim();
    if (!url) {
      throw new EnvironmentError(
        "This Preview deployment has no isolated database. Set PREVIEW_DATABASE_URL (Preview environment only) " +
          "to a separate database; production database variables are never used in Preview.",
      );
    }
    return url;
  }
  const url = env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL;
  if (!url) {
    throw new EnvironmentError(
      "DATABASE_URL is not set. Add a Postgres connection string (e.g. from Neon) to .env.local for local dev, " +
        "and as a Vercel project environment variable for deploys.",
    );
  }
  return url;
}

/**
 * Whether this deployment may write to external services or spend paid
 * credits: posting to Asana, submitting URLs to Google's Indexing API,
 * fetching reviews through SerpApi, calling OpenAI. Production and local
 * development may; Preview may not unless explicitly enabled.
 */
export function externalWritesAllowed(env: Env = process.env): boolean {
  return deploymentOf(env) !== "preview" || env.ALLOW_PREVIEW_EXTERNAL_WRITES === "1";
}

const DEV_SESSION_SECRET = "dev-only-insecure-secret-change-me-32b";

/**
 * The key that encrypts session cookies. Only local development may fall back
 * to a built-in value; a deployed Production or Preview without its own
 * SESSION_SECRET (at least 32 characters) refuses to create sessions, because
 * a known key would let anyone forge a signed-in cookie.
 */
export function sessionSecretFor(env: Env = process.env): string {
  const secret = env.SESSION_SECRET?.trim();
  if (deploymentOf(env) === "development") return secret || DEV_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new EnvironmentError(
      "SESSION_SECRET is missing or shorter than 32 characters for this deployment. Set it in the hosting " +
        "provider's environment variables (a different value for Production and Preview).",
    );
  }
  return secret;
}

/** Scheduled jobs run only in production. */
export function schedulesAllowed(env: Env = process.env): boolean {
  return deploymentOf(env) === "production";
}

export const PREVIEW_WRITES_BLOCKED =
  "Disabled in Preview deployments: this action writes to an external service or spends paid credits. " +
  "Use production, or set ALLOW_PREVIEW_EXTERNAL_WRITES=1 for this Preview on purpose.";
