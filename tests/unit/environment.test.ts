import { describe, expect, it } from "vitest";
import {
  EnvironmentError,
  databaseUrlFor,
  deploymentOf,
  externalWritesAllowed,
  missingPreviewSettings,
  schedulesAllowed,
  sessionSecretFor,
} from "@/lib/environment";

const PROD_DB = "postgres://u:p@prod-host/neondb";
const PREVIEW_DB = "postgres://u:p@prod-host/seo_console_preview";

describe("deploymentOf", () => {
  it("reads VERCEL_ENV and treats everything else as development", () => {
    expect(deploymentOf({ VERCEL_ENV: "production" })).toBe("production");
    expect(deploymentOf({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(deploymentOf({})).toBe("development");
    expect(deploymentOf({ VERCEL_ENV: "something" })).toBe("development");
  });
});

describe("databaseUrlFor", () => {
  it("never uses production variables in Preview, even when Vercel exposes them", () => {
    expect(databaseUrlFor({ VERCEL_ENV: "preview", DATABASE_URL: PROD_DB, PREVIEW_DATABASE_URL: PREVIEW_DB })).toBe(
      PREVIEW_DB,
    );
    expect(() => databaseUrlFor({ VERCEL_ENV: "preview", DATABASE_URL: PROD_DB, POSTGRES_URL: PROD_DB })).toThrow(
      EnvironmentError,
    );
  });

  it("uses DATABASE_URL, then the Neon variables, elsewhere", () => {
    expect(databaseUrlFor({ VERCEL_ENV: "production", DATABASE_URL: PROD_DB })).toBe(PROD_DB);
    expect(databaseUrlFor({ POSTGRES_URL: PROD_DB })).toBe(PROD_DB);
    expect(() => databaseUrlFor({})).toThrow(/DATABASE_URL is not set/);
  });
});

describe("sessionSecretFor", () => {
  const strong = "x".repeat(32);
  it("never falls back to the built-in key on a deployment", () => {
    expect(() => sessionSecretFor({ VERCEL_ENV: "preview" })).toThrow(EnvironmentError);
    expect(() => sessionSecretFor({ VERCEL_ENV: "production" })).toThrow(EnvironmentError);
    expect(() => sessionSecretFor({ VERCEL_ENV: "preview", SESSION_SECRET: "short" })).toThrow(/32 characters/);
    expect(sessionSecretFor({ VERCEL_ENV: "preview", SESSION_SECRET: strong })).toBe(strong);
  });
  it("allows a development fallback only locally", () => {
    expect(sessionSecretFor({}).length).toBeGreaterThanOrEqual(32);
    expect(sessionSecretFor({ SESSION_SECRET: strong })).toBe(strong);
  });
});

describe("external writes and schedules", () => {
  it("are off in Preview unless explicitly enabled", () => {
    expect(externalWritesAllowed({ VERCEL_ENV: "preview" })).toBe(false);
    expect(externalWritesAllowed({ VERCEL_ENV: "preview", ALLOW_PREVIEW_EXTERNAL_WRITES: "true" })).toBe(false);
    expect(externalWritesAllowed({ VERCEL_ENV: "preview", ALLOW_PREVIEW_EXTERNAL_WRITES: "1" })).toBe(true);
    expect(externalWritesAllowed({ VERCEL_ENV: "production" })).toBe(true);
    expect(externalWritesAllowed({})).toBe(true);
  });

  it("schedules run in production only", () => {
    expect(schedulesAllowed({ VERCEL_ENV: "production" })).toBe(true);
    expect(schedulesAllowed({ VERCEL_ENV: "preview" })).toBe(false);
    expect(schedulesAllowed({})).toBe(false);
  });
});

describe("missingPreviewSettings", () => {
  const ready = {
    VERCEL_ENV: "preview",
    PREVIEW_DATABASE_URL: PREVIEW_DB,
    SESSION_SECRET: "x".repeat(32),
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_REDIRECT_URI: "https://example.invalid/api/auth/google/callback",
  };

  it("lists every missing Preview setting by name", () => {
    expect(missingPreviewSettings({ VERCEL_ENV: "preview", DATABASE_URL: PROD_DB, SESSION_SECRET: "short" })).toEqual([
      "PREVIEW_DATABASE_URL",
      "SESSION_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI",
    ]);
  });

  it("is empty for a configured Preview, and never applies outside Preview", () => {
    expect(missingPreviewSettings(ready)).toEqual([]);
    expect(missingPreviewSettings({ VERCEL_ENV: "production" })).toEqual([]);
    expect(missingPreviewSettings({})).toEqual([]);
  });
});
