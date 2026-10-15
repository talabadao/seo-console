// Project SerpApi credential: persistence, status fields, ownership and decoupling from other project fields.
// Runs against a real Postgres engine (PGlite) so the SQL (RIGHT(), updated_at) is exercised for real.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { pg } = await vi.hoisted(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  return { pg: new PGlite() };
});

const toPositional = (sql: string) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

vi.mock("@/lib/db", () => ({
  db: {
    prepare: (sql: string) => ({
      get: async (...args: unknown[]) => (await pg.query(toPositional(sql), args)).rows[0],
      all: async (...args: unknown[]) => (await pg.query(toPositional(sql), args)).rows,
      run: async (...args: unknown[]) => {
        const r = await pg.query(toPositional(sql), args);
        return { count: r.affectedRows ?? 0, rows: r.rows };
      },
    }),
  },
  tableExists: async () => true,
}));

import {
  ProjectValidationError,
  getProject,
  isCredentialPlaceholder,
  removeSerpKey,
  serpKeyFor,
  setSerpKey,
  updateProject,
} from "@/lib/projects";

beforeAll(async () => {
  await pg.exec(`
    CREATE TABLE users (id BIGSERIAL PRIMARY KEY);
    CREATE TABLE sites (user_id BIGINT, source TEXT, property TEXT);
    CREATE TABLE ga_properties (user_id BIGINT, property_id TEXT);
    CREATE TABLE projects (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL, name TEXT NOT NULL DEFAULT '',
      website_url TEXT NOT NULL DEFAULT '', favicon_url TEXT NOT NULL DEFAULT '',
      gsc_property TEXT, ga_property_id TEXT, maps_url TEXT NOT NULL DEFAULT '',
      gbp_location TEXT, gbp_location_title TEXT, serpapi_key TEXT, serpapi_key_updated_at BIGINT,
      asana_project_gid TEXT NOT NULL DEFAULT '', asana_project_name TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0
    );
    INSERT INTO users DEFAULT VALUES; INSERT INTO users DEFAULT VALUES;`);
});

beforeEach(async () => {
  await pg.exec("DELETE FROM projects;");
  await pg.query(
    `INSERT INTO projects (id, user_id, name, website_url) VALUES (1, 1, 'Wewine', 'https://wewine.vn/'), (2, 2, 'Other', 'https://other.example/')`,
  );
});

afterEach(() => vi.clearAllMocks());

describe("isCredentialPlaceholder", () => {
  it("treats blank and all-mask values as placeholders, a real key as not", () => {
    expect(isCredentialPlaceholder("")).toBe(true);
    expect(isCredentialPlaceholder("   ")).toBe(true);
    expect(isCredentialPlaceholder("••••••")).toBe(true);
    expect(isCredentialPlaceholder("····")).toBe(true);
    expect(isCredentialPlaceholder("abc123def456")).toBe(false);
  });
});

describe("setSerpKey / removeSerpKey", () => {
  it("persists the key, stamps updated_at, and exposes status without the key", async () => {
    const before = Date.now() - 1;
    const project = await setSerpKey(1, 1, "  0123456789abcdef  ");
    expect(project).not.toBeNull();
    expect(project!.hasSerpKey).toBe(true);
    expect(project!.serpKeyLast4).toBe("cdef");
    expect(project!.serpKeyUpdatedAt).toBeGreaterThanOrEqual(before);
    // The raw key is stored trimmed and never part of the returned Project.
    expect(await serpKeyFor(1)).toBe("0123456789abcdef");
    expect(JSON.stringify(project)).not.toContain("0123456789abcdef");
  });

  it("rejects a blank key (removal is explicit)", async () => {
    await expect(setSerpKey(1, 1, "   ")).rejects.toBeInstanceOf(ProjectValidationError);
  });

  it("removes the key and clears the status", async () => {
    await setSerpKey(1, 1, "0123456789abcdef");
    const project = await removeSerpKey(1, 1);
    expect(project!.hasSerpKey).toBe(false);
    expect(project!.serpKeyLast4).toBeNull();
    expect(project!.serpKeyUpdatedAt).toBeNull();
    expect(await serpKeyFor(1)).toBeNull();
  });

  it("won't touch another account's project", async () => {
    expect(await setSerpKey(1, 2, "mine-not-yours")).toBeNull();
    expect(await serpKeyFor(2)).toBeNull();
    await setSerpKey(2, 2, "owner-key-xyz");
    expect(await removeSerpKey(1, 2)).toBeNull();
    expect(await serpKeyFor(2)).toBe("owner-key-xyz");
  });
});

describe("decoupling from other project fields", () => {
  it("saves the key even when an unrelated field update would fail", async () => {
    // An invalid website makes updateProject throw...
    await expect(updateProject(1, 1, { websiteUrl: "not a url" })).rejects.toBeInstanceOf(ProjectValidationError);
    // ...but the credential is saved through its own path regardless.
    const project = await setSerpKey(1, 1, "key-independent-of-fields");
    expect(project!.hasSerpKey).toBe(true);
    expect(await serpKeyFor(1)).toBe("key-independent-of-fields");
  });

  it("a combined project update with no key field keeps the saved key (empty unchanged = keep)", async () => {
    await setSerpKey(1, 1, "keep-me-please");
    const project = await updateProject(1, 1, { name: "Wewine VN" });
    expect(project!.name).toBe("Wewine VN");
    expect(project!.hasSerpKey).toBe(true);
    expect(await serpKeyFor(1)).toBe("keep-me-please");
  });
});

describe("getProject status fields", () => {
  it("reports not-configured when no key is saved", async () => {
    const project = await getProject(1, 1);
    expect(project!.hasSerpKey).toBe(false);
    expect(project!.serpKeyLast4).toBeNull();
    expect(project!.serpKeyUpdatedAt).toBeNull();
  });
});
