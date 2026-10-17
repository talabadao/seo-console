// The team workspace model (docs/seo-console-v2/WORKSPACE-MEMBERS.md), on the real schema (baseline + every
// migration, PGlite): admission and canonical identities; sessions rechecked on every request; linking another
// login with verified proof, and merging two records with explicit conflict choices (credentials re-encrypted and
// still usable, consumed allowances added, nothing duplicated); project management shared among members with the
// last-manager and primary-manager rules; recoverable deletion that cancels pending work; mappings validated
// against the workspace's connections; scheduled paid work billed only to the consenting primary manager and
// rechecked at execution; and the OAuth callback, where connecting a shared Google account never changes the
// personal session.
import { beforeAll, describe, expect, it, vi } from "vitest";

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

// The cookie session: one in-memory session object (iron-session is replaced; lib/session.ts is the real code).
const session: Record<string, unknown> & { save: () => Promise<void> } = { save: async () => {} };
vi.mock("iron-session", () => ({ getIronSession: async () => session }));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));

// Google's token endpoint and ID-token verification: answers set per test.
let tokens: Record<string, unknown> = {};
let verifiedClaims: Record<string, unknown> | null = null;
vi.mock("@/lib/google/oauth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/google/oauth")>("@/lib/google/oauth");
  return {
    ...actual,
    oauthClient: () => ({
      getToken: async () => ({ tokens }),
      verifyIdToken: async () => ({ getPayload: () => verifiedClaims }),
      setCredentials: () => {},
      refreshAccessToken: async () => {
        throw new Error("network blocked");
      },
    }),
  };
});
vi.mock("@/lib/google/discovery", () => ({ refreshConnection: async () => null }));
vi.stubGlobal("fetch", async (url: unknown) => {
  throw new Error(`network blocked: ${String(url)}`);
});

import { NextRequest } from "next/server";
import { BASELINE_STATEMENTS } from "@/lib/schema";
import { MIGRATIONS } from "@/db/migrations";
import { currentUser } from "@/lib/session";
import { linkIdentity, signInWithGoogle, unlinkIdentity } from "@/lib/auth/identities";
import { cancelMerge, mergePreview, performMerge } from "@/lib/auth/merge";
import { readCredential, saveCredential } from "@/lib/credentials/store";
import { resolveCredential } from "@/lib/credentials/resolve";
import { setLimit } from "@/lib/budgets";
import { isDocsAdmin } from "@/lib/docs/store";
import {
  ProjectForbiddenError,
  ProjectValidationError,
  addManagers,
  createProject,
  deleteProject,
  getProject,
  listManagers,
  listProjects,
  removeManager,
  transferPrimary,
  updateProject,
} from "@/lib/projects";
import { authorizeScheduledRun, queueScheduledRun, recordedAuthorization, scheduledPayer, setScheduledSpending } from "@/lib/spending";
import { connectionAccessToken } from "@/lib/google/connections";

const ISS = "https://accounts.google.com";
const claims = (email: string, sub: string, hd?: string) => ({ iss: ISS, sub, email, email_verified: true, ...(hd ? { hd } : {}) });
const TIN = 1;
const ALICE = 2;
const BOB = 3;
const ANALYTICS = 4;
const TIN_AD = 5; // Tin's company login, signed in once before linking: its own record
const q1 = async <T = Record<string, unknown>,>(sql: string, args: unknown[] = []) => (await pg.query(sql, args)).rows[0] as T;
const idOf = async (subject: string) => Number((await q1<{ id: number }>("SELECT id FROM user_identities WHERE subject = $1", [subject])).id);

beforeAll(async () => {
  vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  for (const s of BASELINE_STATEMENTS) await pg.exec(s);
  for (const m of MIGRATIONS.slice(1)) for (const s of m.statements) await pg.exec(s);
  await pg.exec(`
    INSERT INTO users (id, email, name, kind, status, workspace_id, created_at, updated_at) VALUES
      (1, 'tinledoihoa@gmail.com', 'Tin', 'person', 'active', 1, 0, 0),
      (2, 'alice@artemisdigital.com', 'Alice', 'person', 'active', 1, 0, 0),
      (3, 'bob@headsonpillows.com', 'Bob', 'person', 'active', 1, 0, 0),
      (4, 'analytics@artemisdigital.com', NULL, 'shared-connection', 'active', NULL, 0, 0),
      (5, 'tin@artemisdigital.com', 'Tin (company)', 'person', 'active', 1, 0, 0),
      (6, 'tin@headsonpillows.com', NULL, 'person', 'active', 1, 0, 0);
    SELECT setval(pg_get_serial_sequence('users', 'id'), 100);
    INSERT INTO user_identities (user_id, issuer, subject, email, hosted_domain, created_at) VALUES
      (1, '${ISS}', 's-tin-gmail', 'tinledoihoa@gmail.com', NULL, 0),
      (2, '${ISS}', 's-alice', 'alice@artemisdigital.com', 'artemisdigital.com', 0),
      (3, '${ISS}', 's-bob', 'bob@headsonpillows.com', 'headsonpillows.com', 0),
      (5, '${ISS}', 's-tin-ad', 'tin@artemisdigital.com', 'artemisdigital.com', 0);
    -- Two shared connections that both read GA4 property 900 (so a mapping must say which); one reads 901.
    INSERT INTO google_connections (id, workspace_id, issuer, subject, email, status, created_at, updated_at) VALUES
      (1, 1, '${ISS}', 'c-ad', 'analytics@artemisdigital.com', 'ok', 0, 0),
      (2, 1, '${ISS}', 'c-hop', 'analytics@headsonpillows.com', 'ok', 0, 0);
    SELECT setval(pg_get_serial_sequence('google_connections', 'id'), 10);
    INSERT INTO ga_properties (user_id, connection_id, property_id, display_name, created_at) VALUES
      (NULL, 1, '900', 'Shared', 0), (NULL, 2, '900', 'Shared', 0), (NULL, 2, '901', 'HoP only', 0);
  `);
});

describe("sign-in and admission", () => {
  it("registers an eligible new company login as a person in the team workspace, keyed by issuer and subject", async () => {
    const r = await signInWithGoogle(claims("carol@headsonpillows.com", "s-carol", "headsonpillows.com"));
    expect(r).toMatchObject({ ok: true, created: true });
    const id = (r as { userId: number }).userId;
    expect(await q1("SELECT kind, status, workspace_id FROM users WHERE id = $1", [id])).toEqual({ kind: "person", status: "active", workspace_id: 1 });
    // The same Google account again, even after its address was renamed: the same User.
    expect(await signInWithGoogle(claims("carol.new@headsonpillows.com", "s-carol", "headsonpillows.com"))).toMatchObject({ ok: true, userId: id, created: false });
  });

  it("claims an unclaimed legacy record only by its exact verified address", async () => {
    expect(await signInWithGoogle(claims("tin@headsonpillows.com", "s-tin-hop", "headsonpillows.com"))).toMatchObject({ ok: true, userId: 6, created: false });
  });

  it("refuses the shared analytics accounts, other Gmail accounts and a recorded address under a new Google account", async () => {
    const before = await q1<{ n: number }>("SELECT COUNT(*)::int AS n FROM users");
    expect(await signInWithGoogle(claims("analytics@artemisdigital.com", "s-analytics", "artemisdigital.com"))).toEqual({ ok: false, reason: "shared-account" });
    expect(await signInWithGoogle(claims("someone@gmail.com", "s-someone"))).toMatchObject({ ok: false });
    // Alice's address under a different Google subject is never taken over by address alone.
    expect(await signInWithGoogle(claims("alice@artemisdigital.com", "s-alice-recreated", "artemisdigital.com"))).toMatchObject({ ok: false, reason: "conflict" });
    expect(await q1("SELECT COUNT(*)::int AS n FROM users")).toEqual(before);
  });

  it("refuses a disabled person", async () => {
    await pg.exec("UPDATE users SET status = 'disabled' WHERE id = 3");
    try {
      expect(await signInWithGoogle(claims("bob@headsonpillows.com", "s-bob", "headsonpillows.com"))).toEqual({ ok: false, reason: "disabled" });
    } finally {
      await pg.exec("UPDATE users SET status = 'active' WHERE id = 3");
    }
  });
});

describe("sessions are rechecked on every request", () => {
  const signed = async (userId: number, identityId: number | undefined) => {
    session.userId = userId;
    session.identityId = identityId;
    return currentUser();
  };

  it("needs the session's own linked, still-eligible identity of an active person", async () => {
    expect((await signed(ALICE, await idOf("s-alice")))?.id).toBe(ALICE);
    expect(await signed(ALICE, undefined)).toBeNull(); // a cookie from before the workspace model
    expect(await signed(ALICE, await idOf("s-bob"))).toBeNull(); // someone else's identity
    expect(await signed(ANALYTICS, undefined)).toBeNull();
    await pg.exec("UPDATE user_identities SET hosted_domain = NULL WHERE subject = 's-alice'"); // no longer a company Workspace login
    expect(await signed(ALICE, await idOf("s-alice"))).toBeNull();
    await pg.exec("UPDATE user_identities SET hosted_domain = 'artemisdigital.com' WHERE subject = 's-alice'");
    await pg.exec("UPDATE users SET status = 'disabled' WHERE id = 2");
    expect(await signed(ALICE, await idOf("s-alice"))).toBeNull();
    await pg.exec("UPDATE users SET status = 'active' WHERE id = 2");
    expect((await signed(ALICE, await idOf("s-alice")))?.id).toBe(ALICE);
  });
});

describe("linked logins and merging two records of one person", () => {
  it("links a new verified login; refuses ineligible ones and analytics accounts", async () => {
    const r = await linkIdentity(ALICE, claims("alice.ops@artemisdigital.com", "s-alice-ops", "artemisdigital.com"));
    expect(r).toMatchObject({ ok: true, status: "linked" });
    expect(await linkIdentity(ALICE, claims("alice.ops@artemisdigital.com", "s-alice-ops", "artemisdigital.com"))).toMatchObject({ ok: true, status: "already-linked" });
    expect(await linkIdentity(ALICE, claims("alice@gmail.com", "s-alice-gmail"))).toMatchObject({ ok: false });
    expect(await linkIdentity(ALICE, claims("analytics@artemisdigital.com", "s-an", "artemisdigital.com"))).toEqual({ ok: false, reason: "shared-account" });
  });

  it("can't remove the only login; can remove another", async () => {
    expect(await unlinkIdentity(BOB, await idOf("s-bob"))).toMatchObject({ ok: false });
    expect(await unlinkIdentity(ALICE, await idOf("s-bob"))).toMatchObject({ ok: false }); // not hers
    expect(await unlinkIdentity(ALICE, await idOf("s-alice-ops"))).toEqual({ ok: true });
  });

  let requestId = 0;
  it("linking a login that already has its own record needs a merge with a preview and explicit choices", async () => {
    // Both records have history: different SerpApi keys and limits; the company record also has an OpenAI key,
    // a managed project, a notification, a saved report and consumed allowance this month.
    await saveCredential(TIN, "serpapi", { apiKey: "tin-gmail-serp-1111" });
    await saveCredential(TIN_AD, "serpapi", { apiKey: "tin-company-serp-2222" });
    await saveCredential(TIN_AD, "openai", { apiKey: "sk-tin-company-3333" });
    await setLimit(TIN, "account", null, "serpapi_requests_month", 100);
    await setLimit(TIN_AD, "account", null, "serpapi_requests_month", 50);
    const p = await createProject(TIN_AD, { name: "Company project" });
    await pg.query("INSERT INTO notifications (user_id, project_id, rule, dedupe_key, severity, title, body, source_at, created_at) VALUES (5, $1, 'performance', 'd1', 'info', 'From company record', 'b', 1, 1)", [p.id]);
    await pg.exec(`INSERT INTO provider_allowances (key, max_units, used_units, note, created_at, updated_at) VALUES
      ('serpapi-month:user:1:2026-10', 100, 2, 'x', 0, 0), ('serpapi-month:user:5:2026-10', 50, 3, 'x', 0, 0)`);
    await pg.exec("UPDATE users SET asana_user_gid = 'g-tin', asana_user_name = 'Tin' WHERE id = 5"); // confirmed on the company record only

    const r = await linkIdentity(TIN, claims("tin@artemisdigital.com", "s-tin-ad", "artemisdigital.com"));
    expect(r).toMatchObject({ ok: true, status: "merge-required" });
    requestId = (r as { mergeRequestId: number }).mergeRequestId;
    expect(await mergePreview(requestId, ALICE)).toBeNull(); // only the person who started it
    const preview = (await mergePreview(requestId, TIN))!;
    expect(preview.source).toMatchObject({ id: TIN_AD, identities: ["tin@artemisdigital.com"] });
    expect(preview.moves).toMatchObject({ projectsManaged: 1, credentials: 2, budgets: 1, notifications: 1 });
    expect(preview.conflicts.map((c) => `${c.area}:${c.key}`).sort()).toEqual(["budget:0:serpapi_requests_month", "credential:serpapi"]);

    // Without a choice for every difference nothing happens.
    const refused = await performMerge(requestId, TIN, { "credential:serpapi": "source" });
    expect(refused).toMatchObject({ ok: false, missing: ["budget:0:serpapi_requests_month"] });
    expect(await q1("SELECT status FROM users WHERE id = 5")).toEqual({ status: "active" });
  });

  it("merges into one User: keys re-encrypted and usable, allowances added, memberships and inbox moved", async () => {
    expect(await performMerge(requestId, TIN, { "credential:serpapi": "source", "budget:0:serpapi_requests_month": "target" })).toEqual({ ok: true });
    // Keys decrypt under the surviving User's binding; the chosen one won; nothing left on the merged record.
    expect((await readCredential(TIN, "serpapi"))?.values.apiKey).toBe("tin-company-serp-2222");
    expect((await readCredential(TIN, "openai"))?.values.apiKey).toBe("sk-tin-company-3333");
    expect((await resolveCredential(TIN, "serpapi"))?.values.apiKey).toBe("tin-company-serp-2222");
    expect(await q1("SELECT COUNT(*)::int AS n FROM account_credentials WHERE user_id = 5")).toEqual({ n: 0 });
    // Limits: the chosen value, one row.
    expect((await pg.query("SELECT user_id, limit_value FROM budget_limits WHERE metric = 'serpapi_requests_month' AND project_id = 0 ORDER BY user_id")).rows).toEqual([{ user_id: 1, limit_value: 100 }]);
    // Consumed allowance is added, never reset or duplicated.
    expect((await pg.query("SELECT key, used_units FROM provider_allowances WHERE key LIKE 'serpapi-month:user:%' ORDER BY key")).rows).toEqual([
      { key: "serpapi-month:user:1:2026-10", used_units: 5 },
      { key: "serpapi-month:user:5:2026-10", used_units: 0 },
    ]);
    // Management and inbox moved; one record remains active; the login now belongs to Tin.
    const managed = await q1<{ id: number; primary_manager_id: number }>("SELECT id, primary_manager_id FROM projects WHERE name = 'Company project'");
    expect(managed.primary_manager_id).toBe(TIN);
    expect((await listManagers(managed.id)).map((m) => m.userId)).toEqual([TIN]);
    expect(await q1("SELECT user_id FROM notifications WHERE dedupe_key = 'd1'")).toEqual({ user_id: TIN });
    expect(await q1("SELECT status, merged_into FROM users WHERE id = 5")).toEqual({ status: "merged", merged_into: TIN });
    expect(await q1("SELECT asana_user_gid FROM users WHERE id = 1")).toEqual({ asana_user_gid: "g-tin" }); // moved under the one-active-owner index
    expect(await q1("SELECT user_id FROM user_identities WHERE subject = 's-tin-ad'")).toEqual({ user_id: TIN });
    expect(await q1("SELECT event FROM identity_audit WHERE user_id = 1 AND event = 'merge'")).toEqual({ event: "merge" });
    // Docs publishing stays with Tin's verified linked profile, through either login.
    expect(await isDocsAdmin({ id: TIN }, { DOCS_ADMIN_EMAILS: "tin@artemisdigital.com" })).toBe(true);
    // Signing in with the company login now opens Tin's profile; the merged record's old session is signed out.
    expect(await signInWithGoogle(claims("tin@artemisdigital.com", "s-tin-ad", "artemisdigital.com"))).toMatchObject({ ok: true, userId: TIN });
    session.userId = TIN_AD;
    session.identityId = await idOf("s-tin-ad");
    expect(await currentUser()).toBeNull();
    // The request can't be replayed.
    expect(await performMerge(requestId, TIN, {})).toMatchObject({ ok: false });
  });

  it("a declined or expired merge changes nothing", async () => {
    const r = (await linkIdentity(TIN, claims("tin@headsonpillows.com", "s-tin-hop", "headsonpillows.com"))) as { mergeRequestId: number };
    expect(await cancelMerge(r.mergeRequestId, TIN)).toBe(true);
    expect(await mergePreview(r.mergeRequestId, TIN)).toBeNull();
    const r2 = (await linkIdentity(TIN, claims("tin@headsonpillows.com", "s-tin-hop", "headsonpillows.com"))) as { mergeRequestId: number };
    await pg.query("UPDATE merge_requests SET expires_at = 1 WHERE id = $1", [r2.mergeRequestId]);
    expect(await performMerge(r2.mergeRequestId, TIN, {})).toMatchObject({ ok: false });
    expect(await q1("SELECT status FROM users WHERE id = 6")).toEqual({ status: "active" });
  });
});

describe("projects: everyone views, management is shared", () => {
  let pid = 0;
  it("any User creates a project and becomes its first manager and primary manager; everyone active sees it", async () => {
    const p = await createProject(ALICE, { name: "Alice's site", websiteUrl: "https://alice.example/" });
    pid = p.id;
    expect(p).toMatchObject({ canManage: true, isPrimaryManager: true, brandName: "Artemis Digital", primaryManagerId: ALICE });
    expect((await listProjects(BOB)).find((x) => x.id === pid)).toMatchObject({ canManage: false, managerCount: 1 });
    expect(await listProjects(ANALYTICS)).toEqual([]); // a data connection is not a User
    await expect(createProject(ANALYTICS, { name: "x" })).rejects.toBeInstanceOf(ProjectForbiddenError);
  });

  it("a viewer can't edit, share, transfer, remove or delete", async () => {
    expect(await updateProject(BOB, pid, { name: "hacked" })).toBeNull();
    await expect(addManagers(BOB, pid, [BOB])).rejects.toBeInstanceOf(ProjectForbiddenError);
    await expect(transferPrimary(BOB, pid, BOB)).rejects.toBeInstanceOf(ProjectForbiddenError);
    await expect(removeManager(BOB, pid, ALICE, { newPrimaryId: BOB })).rejects.toBeInstanceOf(ProjectForbiddenError);
    expect(await deleteProject(BOB, pid)).toBe(false);
    expect(await q1("SELECT name, deleted_at FROM projects WHERE id = $1", [pid])).toEqual({ name: "Alice's site", deleted_at: null });
  });

  it("shares only with active team members; every manager has the same powers", async () => {
    await expect(addManagers(ALICE, pid, [ANALYTICS])).rejects.toBeInstanceOf(ProjectValidationError);
    await expect(addManagers(ALICE, pid, [TIN_AD])).rejects.toBeInstanceOf(ProjectValidationError); // merged record
    expect(await addManagers(ALICE, pid, [BOB])).toEqual({ added: 1 });
    // Bob (not primary) edits, shares, transfers primary to himself and removes the creator.
    expect((await updateProject(BOB, pid, { name: "Renamed by Bob" }))?.name).toBe("Renamed by Bob");
    expect(await addManagers(BOB, pid, [TIN])).toEqual({ added: 1 });
    await transferPrimary(BOB, pid, BOB);
    await removeManager(BOB, pid, ALICE);
    expect((await listManagers(pid)).map((m) => [m.userId, m.isPrimary])).toEqual([[BOB, true], [TIN, false]]);
    expect((await getProject(ALICE, pid))?.canManage).toBe(false); // Alice still views it
  });

  it("keeps at least one manager, and the primary manager is always a member", async () => {
    await expect(removeManager(TIN, pid, BOB)).rejects.toThrow(/new primary manager/);
    await removeManager(TIN, pid, BOB, { newPrimaryId: TIN });
    expect((await listManagers(pid)).map((m) => [m.userId, m.isPrimary])).toEqual([[TIN, true]]);
    await expect(removeManager(TIN, pid, TIN, { newPrimaryId: ALICE })).rejects.toThrow(/at least one manager/);
  });

  it("validates mappings against the workspace's connections", async () => {
    await expect(updateProject(TIN, pid, { gaPropertyId: "999" })).rejects.toThrow(/isn't available through any connected Google account/);
    await expect(updateProject(TIN, pid, { gaPropertyId: "900" })).rejects.toThrow(/Several connected Google accounts/);
    await expect(updateProject(TIN, pid, { gaPropertyId: "901", gaConnectionId: 1 })).rejects.toThrow(/isn't available through the chosen Google connection/);
    expect(await updateProject(TIN, pid, { gaPropertyId: "900", gaConnectionId: 2 })).toMatchObject({ gaPropertyId: "900", gaConnectionId: 2 });
    expect(await updateProject(TIN, pid, { gaPropertyId: "901" })).toMatchObject({ gaPropertyId: "901", gaConnectionId: 2 });
  });

  it("deletion is recoverable and cancels pending work only", async () => {
    await pg.query(
      `INSERT INTO sync_jobs (scope, cache_key, kind, provider, project_id, query, reason, status, run_after, created_at) VALUES
        ('ws:1', 'a', 'summary:gsc', 'gsc', $1, '{}', 'refresh', 'queued', 0, 0), ('ws:1', 'b', 'summary:gsc', 'gsc', $1, '{}', 'refresh', 'done', 0, 0)`,
      [pid],
    );
    await pg.query(
      `INSERT INTO ai_runs (id, user_id, project_id, kind, trigger, status, started_at) VALUES ('q1', 1, $1, 'tracking', 'manual', 'queued', 0), ('d1', 1, $1, 'tracking', 'manual', 'done', 0)`,
      [pid],
    );
    expect(await deleteProject(TIN, pid)).toBe(true);
    expect(await getProject(TIN, pid)).toBeNull();
    expect((await listProjects(ALICE)).some((p) => p.id === pid)).toBe(false);
    expect((await pg.query("SELECT cache_key, status, cancelled_reason FROM sync_jobs WHERE project_id = $1 ORDER BY cache_key", [pid])).rows).toEqual([
      { cache_key: "a", status: "cancelled", cancelled_reason: "project deleted" },
      { cache_key: "b", status: "done", cancelled_reason: null },
    ]);
    expect((await pg.query("SELECT id, status FROM ai_runs WHERE project_id = $1 ORDER BY id", [pid])).rows).toEqual([
      { id: "d1", status: "done" },
      { id: "q1", status: "cancelled" },
    ]);
    // Recoverable: the row, its members and settings are kept; restoring is clearing deleted_at.
    expect(await q1("SELECT deleted_by FROM projects WHERE id = $1", [pid])).toEqual({ deleted_by: TIN });
    await pg.query("UPDATE projects SET deleted_at = NULL, deleted_by = NULL WHERE id = $1", [pid]);
    expect((await getProject(TIN, pid))?.canManage).toBe(true);
  });
});

describe("paid work: manual runs bill the actor, scheduled runs bill the consenting primary manager", () => {
  let pid = 0;
  it("manual: only the acting person's own key, never a teammate's or a shared server key", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "server-key");
    pid = (await createProject(ALICE, { name: "Billing" })).id;
    await addManagers(ALICE, pid, [BOB]);
    await saveCredential(ALICE, "serpapi", { apiKey: "alice-serp-aaaa" });
    expect(await resolveCredential(BOB, "serpapi", pid)).toBeNull();
    expect((await resolveCredential(ALICE, "serpapi", pid))?.values.apiKey).toBe("alice-serp-aaaa");
    vi.unstubAllEnvs();
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  });

  it("scheduled: paused until the primary manager consents and has a key of their own", async () => {
    await pg.exec("DELETE FROM account_credentials WHERE user_id = 2");
    expect(await scheduledPayer(pid, "serpapi")).toMatchObject({ ok: false, code: "no-consent" });
    await setScheduledSpending(BOB, "serpapi", true); // another manager's consent doesn't count
    await saveCredential(BOB, "serpapi", { apiKey: "bob-serp-bbbb" });
    expect(await scheduledPayer(pid, "serpapi")).toMatchObject({ ok: false, code: "no-consent" });
    await setScheduledSpending(ALICE, "serpapi", true);
    expect(await scheduledPayer(pid, "serpapi")).toMatchObject({ ok: false, code: "no-key" });
    await saveCredential(ALICE, "serpapi", { apiKey: "alice-serp-aaaa" });
    expect(await scheduledPayer(pid, "serpapi")).toMatchObject({ ok: true, payerUserId: ALICE });
  });

  it("records the payer, key and version on the job and rechecks them at execution", async () => {
    const queued = (await queueScheduledRun(pid, "tracking", "serpapi", { requests: 3 })) as { runId: string };
    const rec = (await recordedAuthorization(queued.runId))!;
    expect(rec).toMatchObject({ payerUserId: ALICE, status: "queued", provider: "serpapi" });
    expect(rec.credentialFingerprint).not.toBe("");
    expect(await authorizeScheduledRun(pid, "serpapi", rec)).toMatchObject({ ok: true, payerUserId: ALICE });
    // A replaced key, withdrawn or re-given consent each stop the recorded job.
    await saveCredential(ALICE, "serpapi", { apiKey: "alice-serp-new-cccc" });
    expect(await authorizeScheduledRun(pid, "serpapi", rec)).toMatchObject({ ok: false, code: "key-changed" });
    const rec2 = (await recordedAuthorization(((await queueScheduledRun(pid, "tracking", "serpapi", {})) as { runId: string }).runId))!;
    await setScheduledSpending(ALICE, "serpapi", false);
    expect(await authorizeScheduledRun(pid, "serpapi", rec2)).toMatchObject({ ok: false, code: "no-consent" });
    await setScheduledSpending(ALICE, "serpapi", true);
    expect(await authorizeScheduledRun(pid, "serpapi", rec2)).toMatchObject({ ok: false, code: "authorization-changed" });
  });

  it("transferring primary management cancels queued work billed to the old manager and never rebills it", async () => {
    const { runId } = (await queueScheduledRun(pid, "tracking", "serpapi", {})) as { runId: string };
    const rec = (await recordedAuthorization(runId))!;
    await pg.query("INSERT INTO ai_runs (id, user_id, project_id, kind, trigger, status, started_at, payer_user_id) VALUES ('bob-manual', 3, $1, 'tracking', 'manual', 'queued', 0, 3)", [pid]);
    await transferPrimary(ALICE, pid, BOB);
    expect((await recordedAuthorization(runId))?.status).toBe("cancelled");
    expect(await q1("SELECT status FROM ai_runs WHERE id = 'bob-manual'")).toEqual({ status: "queued" }); // not billed to Alice
    // Bob already consented and has a key, but the recorded job named Alice: refused, not moved to Bob.
    expect(await authorizeScheduledRun(pid, "serpapi", rec)).toMatchObject({ ok: false, code: "payer-changed" });
    expect(await scheduledPayer(pid, "serpapi")).toMatchObject({ ok: true, payerUserId: BOB });
  });

  it("an inactive payer or a deleted project pauses paid schedules", async () => {
    await pg.exec("UPDATE users SET status = 'disabled' WHERE id = 3");
    expect(await scheduledPayer(pid, "serpapi")).toMatchObject({ ok: false, code: "payer-inactive" });
    await pg.exec("UPDATE users SET status = 'active' WHERE id = 3");
    await deleteProject(BOB, pid);
    expect(await scheduledPayer(pid, "serpapi")).toMatchObject({ ok: false, code: "project-gone" });
  });
});

describe("OAuth callback", () => {
  const callback = async (state = "st") => {
    const { GET } = await import("@/app/api/auth/google/callback/route");
    const res = await GET(new NextRequest(`http://localhost/api/auth/google/callback?code=c&state=${state}`));
    return { status: res.status, location: res.headers.get("location") ?? "" };
  };
  const start = async (purpose: "login" | "link" | "connect-google", userId?: number) => {
    session.userId = userId;
    session.identityId = userId === ALICE ? await idOf("s-alice") : undefined;
    session.oauth = { state: "st", nonce: "n1", purpose, userId, createdAt: Date.now() };
  };

  it("connecting a shared analytics account stores it encrypted and keeps the personal session", async () => {
    await start("connect-google", ALICE);
    tokens = { id_token: "x", refresh_token: "refresh-secret-value", access_token: "access-secret-value", scope: "openid email https://www.googleapis.com/auth/analytics.readonly", expiry_date: Date.now() + 3600_000 };
    verifiedClaims = { ...claims("analytics@headsonpillows.com", "c-hop", "headsonpillows.com"), nonce: "n1" };
    const users = await q1("SELECT COUNT(*)::int AS n FROM users");
    const r = await callback();
    expect(r.location).toContain("/account/connections?connected=2");
    expect([session.userId, session.identityId]).toEqual([ALICE, await idOf("s-alice")]);
    const row = await q1<Record<string, unknown>>("SELECT email, status, granted_by_user_id, ciphertext, access_token FROM google_connections WHERE id = 2");
    expect(row).toMatchObject({ email: "analytics@headsonpillows.com", status: "ok", granted_by_user_id: ALICE });
    expect(JSON.stringify(row)).not.toMatch(/refresh-secret-value|access-secret-value/);
    expect(await connectionAccessToken(2)).toBe("access-secret-value"); // decrypts under the connection's binding
    expect(await q1("SELECT COUNT(*)::int AS n FROM users")).toEqual(users); // no personal record for the analytics account
  });

  it("refuses an arbitrary Google account as a data connection, a wrong nonce and a stale or foreign state", async () => {
    const count = async () => (await q1<{ n: number }>("SELECT COUNT(*)::int AS n FROM google_connections")).n;
    const before = await count();
    await start("connect-google", ALICE);
    verifiedClaims = { ...claims("someone@gmail.com", "s-rand"), nonce: "n1" };
    expect((await callback()).location).toContain("error=");
    await start("connect-google", ALICE);
    verifiedClaims = { ...claims("analytics@artemisdigital.com", "c-ad", "artemisdigital.com"), nonce: "other" };
    expect((await callback()).location).toContain("error=");
    await start("connect-google", ALICE);
    expect((await callback("forged")).location).toContain("error=");
    expect(session.oauth).toBeUndefined(); // a round trip is never completed twice
    expect(await count()).toBe(before);
  });

  it("a connection started by one person can't complete in another person's session", async () => {
    await start("connect-google", BOB); // Bob started it; the session is Alice's now
    session.userId = ALICE;
    session.identityId = await idOf("s-alice");
    verifiedClaims = { ...claims("analytics@artemisdigital.com", "c-ad", "artemisdigital.com"), nonce: "n1" };
    expect((await callback()).location).toContain("error=");
  });

  it("personal sign-in with an analytics account is refused and starts no session", async () => {
    await start("login");
    verifiedClaims = { ...claims("analytics@artemisdigital.com", "c-ad", "artemisdigital.com"), nonce: "n1" };
    expect((await callback()).location).toContain("error=");
    expect(session.userId).toBeUndefined();
    await start("login");
    verifiedClaims = { ...claims("bob@headsonpillows.com", "s-bob", "headsonpillows.com"), nonce: "n1" };
    await callback();
    expect([session.userId, session.identityId]).toEqual([BOB, await idOf("s-bob")]);
  });
});
