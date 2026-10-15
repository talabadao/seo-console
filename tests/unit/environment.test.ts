import { describe, expect, it } from "vitest";
import {
  EnvironmentError,
  databaseUrlFor,
  deploymentOf,
  externalWritesAllowed,
  schedulesAllowed,
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
