// Personal API credentials: encryption, storage/verification states, isolation between people, persistence across a
// fresh server instance, the resolver (a paid request uses only the acting person's OWN key — never a legacy
// project key, another person's or a shared server key), and the protected legacy project-key consolidation.
// Runs on the real schema (baseline + every migration, PGlite).
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
  tableExists: async (name: string) => (await pg.query<{ t: string | null }>("SELECT to_regclass($1) AS t", [`public.${name}`])).rows[0].t != null,
  withTransaction: async <T,>(fn: (q: (sql: string, ...args: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>) =>
    pg.transaction(async (tx) => fn(async (sql, ...args) => (await tx.query(toPositional(sql), args)).rows as Record<string, unknown>[])),
}));

import { BASELINE_STATEMENTS } from "@/lib/schema";
import { MIGRATIONS } from "@/db/migrations";
import { decryptFor, encryptFor } from "@/lib/credentials/crypto";
import {
  CredentialInputError,
  cleanValues,
  credentialStatuses,
  isPlaceholder,
  readCredential,
  recordVerification,
  reencryptAll,
  removeCredential,
  saveCredential,
} from "@/lib/credentials/store";
import { adoptLegacySerpKey, consolidateLegacySerpKeys, resolveCredential } from "@/lib/credentials/resolve";
import { getProject, removeSerpKey, updateProject, ProjectValidationError } from "@/lib/projects";
import { serpKey } from "@/lib/providers/serpapi";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

beforeAll(async () => {
  for (const s of BASELINE_STATEMENTS) await pg.exec(s);
  for (const m of MIGRATIONS.slice(1)) for (const s of m.statements) await pg.exec(s);
  await pg.exec(`INSERT INTO users (id, email, kind, status, workspace_id, created_at, updated_at)
    VALUES (1, 'owner@artemisdigital.com', 'person', 'active', 1, 0, 0), (2, 'other@artemisdigital.com', 'person', 'active', 1, 0, 0);`);
});

beforeEach(async () => {
  vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", KEY_A);
  vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY_ID", "1");
  vi.stubEnv("CREDENTIALS_ENCRYPTION_KEYS_OLD", "");
  vi.stubEnv("LEGACY_SERVER_CREDENTIAL_ACCOUNTS", "");
  vi.stubEnv("SERPAPI_API_KEY", "");
  await pg.exec("DELETE FROM account_credentials; DELETE FROM project_members; DELETE FROM projects;");
  // One workspace: person 1 manages projects 1 and 2 (and is their legacy owner); person 2 manages project 3.
  await pg.query(
    `INSERT INTO projects (id, user_id, name, website_url, workspace_id, created_by, primary_manager_id, created_at, updated_at) VALUES
       (1, 1, 'Wewine', 'https://wewine.vn/', 1, 1, 1, 0, 0), (2, 1, 'Second', 'https://second.example/', 1, 1, 1, 0, 0),
       (3, 2, 'Theirs', 'https://theirs.example/', 1, 2, 2, 0, 0)`,
  );
  await pg.exec("INSERT INTO project_members (project_id, user_id, added_at) VALUES (1, 1, 0), (2, 1, 0), (3, 2, 0)");
});

afterEach(() => vi.unstubAllEnvs());

describe("encryption", () => {
  it("round-trips and binds the ciphertext to its account and provider", () => {
    const { ciphertext, keyId } = encryptFor(1, "serpapi", "secret-value");
    expect(ciphertext).not.toContain("secret-value");
    expect(decryptFor(1, "serpapi", ciphertext, keyId)).toBe("secret-value");
    expect(() => decryptFor(2, "serpapi", ciphertext, keyId)).toThrow();
    expect(() => decryptFor(1, "openai", ciphertext, keyId)).toThrow();
  });

  it("refuses to work without a key, and never falls back to the session secret", () => {
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "");
    vi.stubEnv("SESSION_SECRET", "x".repeat(64));
    expect(() => encryptFor(1, "serpapi", "v")).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
  });

  it("rotates: old rows stay readable with the old key listed, and re-encrypt to the new key", async () => {
    await saveCredential(1, "serpapi", { apiKey: "rotating-key-1234" });
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", KEY_B);
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY_ID", "2");
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEYS_OLD", `1:${KEY_A}`);
    expect((await readCredential(1, "serpapi"))!.values.apiKey).toBe("rotating-key-1234");
    expect(await reencryptAll()).toBe(1);
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEYS_OLD", "");
    expect((await readCredential(1, "serpapi"))!.values.apiKey).toBe("rotating-key-1234");
  });
});

describe("saving, replacing and removing", () => {
  it("saves, reports Saved with a masked hint and Untested, and never returns the secret", async () => {
    const status = await saveCredential(1, "serpapi", { apiKey: "abcdefgh12345678" });
    expect(status).toMatchObject({ provider: "serpapi", saved: true, hint: "5678", verifyStatus: null });
    expect(status.updatedAt).toBeGreaterThan(0);
    expect(JSON.stringify(await credentialStatuses(1))).not.toContain("abcdefgh12345678");
    const raw = (await pg.query<{ ciphertext: string }>("SELECT ciphertext FROM account_credentials WHERE user_id = 1")).rows[0];
    expect(raw.ciphertext).not.toContain("abcdefgh12345678");
  });

  it("keeps storage and verification separate; a replacement starts Untested again", async () => {
    await saveCredential(1, "openai", { apiKey: "sk-first-0001" });
    const first = (await readCredential(1, "openai"))!;
    await recordVerification(1, "openai", first.fingerprint, true, "ok");
    expect((await credentialStatuses(1)).find((s) => s.provider === "openai")!.verifyStatus).toBe("ok");
    await saveCredential(1, "openai", { apiKey: "sk-second-0002" });
    // A late result for the old key can't mark the new one verified.
    await recordVerification(1, "openai", first.fingerprint, true, "late");
    const s = (await credentialStatuses(1)).find((x) => x.provider === "openai")!;
    expect(s).toMatchObject({ saved: true, hint: "0002", verifyStatus: null });
  });

  it("rejects blank or masked input instead of overwriting (unchanged input keeps the saved value)", async () => {
    expect(isPlaceholder("")).toBe(true);
    expect(isPlaceholder("••••••")).toBe(true);
    expect(() => cleanValues("serpapi", { apiKey: "   " })).toThrow(CredentialInputError);
    expect(() => cleanValues("serpapi", { apiKey: "•••••5678" })).toThrow(CredentialInputError);
    expect(() => cleanValues("dataforseo", { login: "me@example.com" })).toThrow(CredentialInputError);
    expect(cleanValues("dataforseo", { login: " me@example.com ", password: "pw123" }).values).toEqual({ login: "me@example.com", password: "pw123" });
  });

  it("stores DataForSEO's API login and API password together, hint shows a masked login", async () => {
    const s = await saveCredential(1, "dataforseo", { login: "analytics@example.com", password: "api-pass-99" });
    expect(s.hint).toBe("an•••@example.com");
    expect((await readCredential(1, "dataforseo"))!.values).toEqual({ login: "analytics@example.com", password: "api-pass-99" });
  });

  it("removes only explicitly", async () => {
    await saveCredential(1, "anthropic", { apiKey: "sk-ant-xyz" });
    expect(await removeCredential(1, "anthropic")).toBe(true);
    expect((await credentialStatuses(1)).find((s) => s.provider === "anthropic")!.saved).toBe(false);
  });
});

describe("account isolation", () => {
  it("keeps each account's credentials separate", async () => {
    await saveCredential(1, "serpapi", { apiKey: "owner-key-1111" });
    await saveCredential(2, "serpapi", { apiKey: "other-key-2222" });
    expect((await readCredential(1, "serpapi"))!.values.apiKey).toBe("owner-key-1111");
    expect((await readCredential(2, "serpapi"))!.values.apiKey).toBe("other-key-2222");
    // Account 2 removing "its" SerpApi credential can't touch account 1's.
    await removeCredential(2, "serpapi");
    expect((await readCredential(1, "serpapi"))!.values.apiKey).toBe("owner-key-1111");
  });

  it("never resolves a project's legacy key, and only managers can remove one", async () => {
    await pg.query("UPDATE projects SET serpapi_key = 'their-project-key' WHERE id = 3");
    // Person 1 can view project 3 but gets nothing from its key, and can't remove it (they don't manage it).
    expect(await resolveCredential(1, "serpapi", 3)).toBeNull();
    expect(await removeSerpKey(1, 3)).toBeNull();
    expect((await pg.query("SELECT serpapi_key FROM projects WHERE id = 3")).rows[0]).toEqual({ serpapi_key: "their-project-key" });
    // Its own manager doesn't get it for runs either.
    expect(await resolveCredential(2, "serpapi", 3)).toBeNull();
  });
});

describe("persistence", () => {
  it("survives a fresh server instance (no in-memory state)", async () => {
    await saveCredential(1, "serpapi", { apiKey: "persisted-key-4242" });
    vi.resetModules();
    const fresh = await import("@/lib/credentials/store");
    expect((await fresh.readCredential(1, "serpapi"))!.values.apiKey).toBe("persisted-key-4242");
    expect((await fresh.credentialStatuses(1)).find((s) => s.provider === "serpapi")).toMatchObject({ saved: true, hint: "4242" });
  });
});

describe("shared resolver", () => {
  it("gives every project of the account the same account credential", async () => {
    await saveCredential(1, "serpapi", { apiKey: "shared-account-key" });
    const a = await serpKey(1, 1);
    const b = await serpKey(1, 2);
    expect(a?.key).toBe("shared-account-key");
    expect(b?.fingerprint).toBe(a?.fingerprint);
    expect(a?.source).toBe("account");
    expect((await getProject(1, 2))!).toMatchObject({ hasSerpKey: true, serpKeySource: "account", serpKeyLast4: "-key" });
  });

  it("never uses a legacy project key for a run; only the person's own key", async () => {
    await pg.query("UPDATE projects SET serpapi_key = 'legacy-project-key' WHERE id = 1");
    expect(await serpKey(1, 1)).toBeNull();
    await saveCredential(1, "serpapi", { apiKey: "account-key-0000" });
    expect((await serpKey(1, 1))!).toMatchObject({ key: "account-key-0000", source: "account" });
    expect((await serpKey(1, 2))!).toMatchObject({ key: "account-key-0000", source: "account" });
    // Person 2 running something on person 1's project would still need their own key.
    expect(await serpKey(2, 1)).toBeNull();
  });

  it("never falls back to a shared server key, even for an account listed in the old setting", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "server-key-zz");
    vi.stubEnv("LEGACY_SERVER_CREDENTIAL_ACCOUNTS", "owner@artemisdigital.com");
    expect(await resolveCredential(1, "serpapi")).toBeNull();
    expect(await resolveCredential(2, "serpapi")).toBeNull();
  });
});

describe("legacy project keys", () => {
  it("consolidates identical project keys into the account credential and clears the plain-text copies", async () => {
    await pg.query("UPDATE projects SET serpapi_key = 'same-key-7777', serpapi_key_updated_at = 1 WHERE user_id = 1");
    const state = await consolidateLegacySerpKeys(1);
    expect(state).toMatchObject({ status: "consolidated", consolidated: 2, pending: [] });
    expect((await readCredential(1, "serpapi"))!.values.apiKey).toBe("same-key-7777");
    const left = await pg.query("SELECT id FROM projects WHERE user_id = 1 AND serpapi_key IS NOT NULL");
    expect(left.rows).toHaveLength(0);
    // Account 2's projects are untouched.
    expect((await readCredential(2, "serpapi"))).toBeNull();
  });

  it("never chooses between different keys; both stay pending (unused for runs) until their legacy owner decides", async () => {
    await pg.query("UPDATE projects SET serpapi_key = 'key-one-1111' WHERE id = 1");
    await pg.query("UPDATE projects SET serpapi_key = 'key-two-2222' WHERE id = 2");
    const state = await consolidateLegacySerpKeys(1);
    expect(state.status).toBe("conflict");
    expect(state.pending.map((p) => p.last4).sort()).toEqual(["1111", "2222"]);
    expect(await readCredential(1, "serpapi")).toBeNull();
    expect(await serpKey(1, 1)).toBeNull();
    expect(await serpKey(1, 2)).toBeNull();
    // Another person can't consolidate (or even see) them: they are only the legacy owner's to decide.
    expect(await consolidateLegacySerpKeys(2)).toMatchObject({ status: "none", pending: [] });
  });

  it("clears only project keys identical to an existing account key", async () => {
    await saveCredential(1, "serpapi", { apiKey: "key-one-1111" });
    await pg.query("UPDATE projects SET serpapi_key = 'key-one-1111' WHERE id = 1");
    await pg.query("UPDATE projects SET serpapi_key = 'key-two-2222' WHERE id = 2");
    const state = await consolidateLegacySerpKeys(1);
    expect(state).toMatchObject({ status: "conflict", consolidated: 1 });
    expect(state.pending[0].projects.map((p) => p.id)).toEqual([2]);
    expect((await readCredential(1, "serpapi"))!.values.apiKey).toBe("key-one-1111");
  });

  it("adopts a chosen project key explicitly", async () => {
    await pg.query("UPDATE projects SET serpapi_key = 'key-one-1111' WHERE id = 1");
    await pg.query("UPDATE projects SET serpapi_key = 'key-two-2222' WHERE id = 2");
    expect(await adoptLegacySerpKey(1, 2)).toBe(true);
    expect((await readCredential(1, "serpapi"))!.values.apiKey).toBe("key-two-2222");
    expect((await serpKey(1, 2))!.source).toBe("account");
    // The account key now applies to every project, including the one that still has its own legacy key.
    expect((await serpKey(1, 1))!).toMatchObject({ key: "key-two-2222", source: "account" });
    // Another account's project can't be adopted.
    await pg.query("UPDATE projects SET serpapi_key = 'their-key' WHERE id = 3");
    expect(await adoptLegacySerpKey(1, 3)).toBe(false);
  });
});

describe("decoupling from other project fields", () => {
  it("a project update that fails validation leaves the credentials alone; one that succeeds keeps them", async () => {
    await saveCredential(1, "serpapi", { apiKey: "untouched-key" });
    await expect(updateProject(1, 1, { websiteUrl: "not a url" })).rejects.toBeInstanceOf(ProjectValidationError);
    const p = await updateProject(1, 1, { name: "Wewine VN" });
    expect(p).toMatchObject({ name: "Wewine VN", hasSerpKey: true, serpKeySource: "account" });
    expect((await readCredential(1, "serpapi"))!.values.apiKey).toBe("untouched-key");
  });
});
