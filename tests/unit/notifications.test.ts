// In-app notifications and Docs: rules only fire on live, complete, non-demo saved results above thresholds and
// minimum volumes; dedupe by rule + project + period; project alerts to managers (personal mutes), task alerts to the
// verified Asana assignee; read/unread per person; project filter; weekly digest once per week; Docs drafts and
// publishing only for explicit admins (by verified linked login); demo examples never notify.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { DEFAULT_SETTINGS, candidatesFrom, isoWeek, normalizeSettings, type CachedSection } from "@/lib/notifications/rules";
import { listMutes, listNotifications, markRead, runRules, saveSettings, setMute } from "@/lib/notifications/store";
import { DocsForbidden, emailIsDocsAdmin, ensureDemoDocs, getArticle, isDocsAdmin, listArticles, saveArticle, setPublished } from "@/lib/docs/store";

const period = { preset: "last28", compare: "previous", label: "", compareLabel: null, current: { start: "2026-09-16", end: "2026-10-13" }, previous: { start: "2026-08-19", end: "2026-09-15" } };
const gsc = (current: number, previous: number, over: Record<string, unknown> = {}): CachedSection => ({
  kind: "summary:gsc",
  projectId: 1,
  projectName: "Wewine",
  query: { period },
  payload: { state: "live", source: "GSC", dataThrough: "2026-10-13", data: { clicks: { current, previous }, impressions: { current: 0, previous: 0 }, ctr: { current: 0, previous: 0 }, position: { current: 0, previous: 0 } }, ...over },
  fetchedAt: Date.now(),
});

describe("rules", () => {
  it("performance: threshold, minimum volume, live and complete data only", () => {
    expect(candidatesFrom([gsc(700, 1000)], DEFAULT_SETTINGS)).toMatchObject([{ rule: "performance", severity: "warning", title: "Wewine: Search Console clicks down 30%" }]);
    expect(candidatesFrom([gsc(1100, 1000)], DEFAULT_SETTINGS)).toEqual([]); // 10% < 20%
    expect(candidatesFrom([gsc(10, 50)], DEFAULT_SETTINGS)).toEqual([]); // below 100 clicks
    expect(candidatesFrom([gsc(700, 1000, { state: "demo" })], DEFAULT_SETTINGS)).toEqual([]);
    expect(candidatesFrom([gsc(700, 1000, { dataThrough: "2026-10-10" })], DEFAULT_SETTINGS)).toEqual([]); // incomplete
    expect(candidatesFrom([{ ...gsc(700, 1000), query: { period: { ...period, preset: "last7" } } }], DEFAULT_SETTINGS)).toEqual([]);
    expect(candidatesFrom([gsc(300, 1000)], DEFAULT_SETTINGS)[0].severity).toBe("critical");
    const s = normalizeSettings({ performance: { minChangePct: 5, minClicks: 10 } });
    expect(candidatesFrom([gsc(1100, 1000), gsc(40, 50)], s)).toHaveLength(1); // same week+metric key deduped
  });

  it("rankings need a comparison, enough keywords and a real change", () => {
    const r = (cur: [number, number], prev: [number, number] | null, checked = 50): CachedSection => ({
      kind: "summary:rankings",
      projectId: 2,
      projectName: "Kin",
      query: { period },
      payload: {
        state: "live",
        source: "SE Ranking",
        data: {
          context: { engine: "Google Vietnam", latestDate: "2026-10-15", comparisonDate: prev ? "2026-09-17" : null, trackedKeywords: checked },
          current: { top10: cur[0], avgPosition: cur[1], checked },
          previous: prev ? { top10: prev[0], avgPosition: prev[1], checked } : null,
        },
      } as never,
      fetchedAt: Date.now(),
    });
    expect(candidatesFrom([r([20, 30], [15, 31])], DEFAULT_SETTINGS)).toMatchObject([{ rule: "rankings", severity: "info", title: "Kin: rankings improved" }]);
    expect(candidatesFrom([r([14, 36], [15, 31])], DEFAULT_SETTINGS)[0].severity).toBe("warning");
    expect(candidatesFrom([r([16, 30], [15, 31])], DEFAULT_SETTINGS)).toEqual([]);
    expect(candidatesFrom([r([20, 30], null)], DEFAULT_SETTINGS)).toEqual([]);
    expect(candidatesFrom([r([20, 30], [15, 31], 5)], DEFAULT_SETTINGS)).toEqual([]);
  });

  it("tasks: overdue, due soon and completed in the last 7 days, capped per project", () => {
    const now = Date.parse("2026-10-16T09:00:00Z");
    const t = (gid: string, dueOn: string | null, completedAt: string | null = null) => ({ gid, name: `Task ${gid}`, assignee: null, dueOn, completedAt, status: "open", url: null });
    const sec: CachedSection = {
      kind: "summary:tasks",
      projectId: 3,
      projectName: "Bhaya",
      query: { period },
      payload: {
        state: "live",
        source: "Asana",
        data: {
          today: "2026-10-16",
          overdueTasks: Array.from({ length: 7 }, (_, i) => t(`o${i}`, "2026-10-10")),
          upcoming: [t("u1", "2026-10-17"), t("u2", "2026-10-30")],
          recentlyCompleted: [t("c1", null, "2026-10-15T10:00:00Z"), t("c2", null, "2026-09-01T10:00:00Z")],
        },
      } as never,
      fetchedAt: now,
    };
    const c = candidatesFrom([sec], DEFAULT_SETTINGS, now);
    expect(c.filter((x) => x.dedupeKey.startsWith("tasks-overdue:"))).toHaveLength(5);
    expect(c.filter((x) => x.dedupeKey.startsWith("tasks-overdue-more:"))).toHaveLength(1);
    expect(c.filter((x) => x.dedupeKey.startsWith("tasks-upcoming:")).map((x) => x.dedupeKey)).toEqual(["tasks-upcoming:3:u1:2026-10-17"]);
    expect(c.filter((x) => x.rule === "content").map((x) => x.dedupeKey)).toEqual(["tasks-done:3:c1"]);
    expect(candidatesFrom([sec], normalizeSettings({ tasks: { enabled: false } }), now)).toEqual([]);
  });

  it("ISO weeks", () => {
    expect(isoWeek("2026-10-16")).toBe("2026-W42");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
  });

  it("settings are clamped and merged over defaults", () => {
    expect(normalizeSettings({ performance: { minChangePct: -5, minClicks: "x" }, digest: { enabled: false } })).toMatchObject({
      performance: { minChangePct: 1, minClicks: 100 },
      digest: { enabled: false },
      docs: { enabled: true },
    });
  });
});

beforeAll(async () => {
  for (const s of BASELINE_STATEMENTS) await pg.exec(s);
  for (const m of MIGRATIONS.slice(1)) for (const s of m.statements) await pg.exec(s);
  // Workspace 1: Tin (1) manages Wewine, a colleague (2) manages Theirs; the analytics account (3) is a data
  // connection only; 4 is outside the workspace; 5 is Tin's company login before it's linked (a separate person).
  await pg.exec(`INSERT INTO users (id, email, kind, status, workspace_id, created_at, updated_at) VALUES
      (1, 'tinledoihoa@gmail.com', 'person', 'active', 1, 0, 0), (2, 'colleague@headsonpillows.com', 'person', 'active', 1, 0, 0),
      (3, 'analytics@artemisdigital.com', 'shared-connection', 'active', NULL, 0, 0), (4, 'stranger@example.com', 'person', 'active', NULL, 0, 0),
      (5, 'tin@artemisdigital.com', 'person', 'active', 1, 0, 0);
    INSERT INTO user_identities (user_id, issuer, subject, email, hosted_domain, created_at) VALUES
      (1, 'https://accounts.google.com', 's1', 'tinledoihoa@gmail.com', NULL, 0),
      (2, 'https://accounts.google.com', 's2', 'colleague@headsonpillows.com', 'headsonpillows.com', 0),
      (4, 'https://accounts.google.com', 's4', 'stranger@example.com', NULL, 0),
      (5, 'https://accounts.google.com', 's5', 'tin@artemisdigital.com', 'artemisdigital.com', 0);
    INSERT INTO projects (id, user_id, name, workspace_id, created_by, primary_manager_id, created_at, updated_at) VALUES
      (1, 1, 'Wewine', 1, 1, 1, 0, 0), (2, 2, 'Theirs', 1, 2, 2, 0, 0);`);
});
beforeEach(async () => {
  await pg.exec(`DELETE FROM notifications; DELETE FROM notification_settings; DELETE FROM notification_mutes; DELETE FROM report_cache; DELETE FROM doc_articles;
    DELETE FROM project_members; INSERT INTO project_members (project_id, user_id, added_at) VALUES (1, 1, 0), (2, 2, 0);
    UPDATE users SET asana_user_gid = NULL;`);
});

/** A saved shared section in workspace `ws`'s cache scope (what a viewer's read leaves behind). */
const saveSection = async (ws: number, s: CachedSection, key: string) =>
  pg.query(
    `INSERT INTO report_cache (scope, cache_key, kind, provider, user_id, project_id, query, payload, fetched_at, fresh_until) VALUES ($1, $2, $3, 'gsc', NULL, $4, $5, $6, $7, $8)`,
    [`ws:${ws}`, key, s.kind, s.projectId, JSON.stringify(s.query), JSON.stringify(s.payload), Date.now(), Date.now() + 1e6],
  );

describe("store", () => {
  const sunday = Date.parse("2026-10-18T12:00:00Z"); // no digest on Sundays
  const monday = Date.parse("2026-10-19T12:00:00Z");

  it("project alerts go to the project's managers once, not to other viewers, and runs are throttled", async () => {
    await saveSection(1, gsc(600, 1000), "a");
    await saveSection(1, gsc(600, 1000), "b"); // same period saved twice
    expect(await runRules(1, { now: sunday })).toEqual({ ran: true, created: 1 });
    expect(await runRules(1, { now: sunday + 60_000 })).toEqual({ ran: false, created: 0 });
    expect((await runRules(1, { now: sunday + 60_000, force: true })).created).toBe(0);
    const list = await listNotifications(1);
    expect(list.unread).toBe(1);
    expect(list.items[0]).toMatchObject({ projectId: 1, projectName: "Wewine", kind: "performance", href: "/p/1/search-console/performance" });
    // The colleague can view Wewine but doesn't manage it: no project alert.
    expect((await runRules(2, { now: sunday })).created).toBe(0);
    expect((await listNotifications(2)).items).toHaveLength(0);
  });

  it("sharing subscribes the new manager; mutes are personal", async () => {
    await saveSection(1, gsc(600, 1000), "a");
    await pg.exec("INSERT INTO project_members (project_id, user_id, added_at) VALUES (1, 2, 0)");
    await setMute(1, 1, "performance", true);
    expect((await runRules(1, { now: sunday })).created).toBe(0); // Tin muted it
    expect((await runRules(2, { now: sunday })).created).toBe(1); // the colleague (now a manager) still gets it
    expect(await listMutes(2)).toEqual([]);
    await setMute(1, 1, "performance", false);
    expect((await runRules(1, { now: sunday, force: true })).created).toBe(1);
  });

  it("task alerts go to the verified Asana assignee in any visible project; managers get completed tasks", async () => {
    const task = (gid: string, assigneeGid: string | null, dueOn: string | null, completedAt: string | null = null) => ({ gid, name: `Task ${gid}`, assignee: null, assigneeGid, dueOn, completedAt, status: "open", url: null });
    await saveSection(
      1,
      {
        kind: "summary:tasks",
        projectId: 1,
        projectName: "Wewine",
        query: { period },
        payload: {
          state: "live",
          source: "Asana",
          data: {
            today: "2026-10-19",
            overdueTasks: [task("o1", "g2", "2026-10-10"), task("o2", "g9", "2026-10-11")],
            upcoming: [task("u1", "g2", "2026-10-20")],
            recentlyCompleted: [task("c1", "g2", null, "2026-10-18T10:00:00Z")],
          },
        } as never,
        fetchedAt: sunday,
      },
      "t",
    );
    await pg.exec("UPDATE users SET asana_user_gid = 'g2' WHERE id = 2");
    await runRules(2, { now: sunday });
    expect((await listNotifications(2)).items.map((i) => i.kind).sort()).toEqual(["tasks", "tasks"]); // o1 and u1 only, not o2
    await runRules(1, { now: sunday });
    expect((await listNotifications(1)).items.map((i) => i.kind)).toEqual(["content"]); // the manager: completed c1 only
  });

  it("never reads another workspace's cache rows", async () => {
    await saveSection(2, gsc(600, 1000), "x");
    expect((await runRules(1, { now: sunday })).created).toBe(0);
  });

  it("read and unread, all or by id, own rows only, project filter", async () => {
    await saveSection(1, gsc(600, 1000), "a");
    await runRules(1, { now: monday }); // performance + digest
    const { items } = await listNotifications(1);
    expect(items.map((i) => i.kind).sort()).toEqual(["digest", "performance"]);
    expect(await markRead(2, { ids: items.map((i) => i.id) })).toBe(0);
    expect(await markRead(1, { ids: [items[0].id] })).toBe(1);
    expect((await listNotifications(1)).unread).toBe(1);
    await markRead(1, { all: true });
    expect((await listNotifications(1)).unread).toBe(0);
    await markRead(1, { ids: [items[0].id], unread: true });
    expect((await listNotifications(1, { unreadOnly: true })).items.map((i) => i.id)).toEqual([items[0].id]);
    // Project filter keeps account-wide items (the digest).
    expect((await listNotifications(1, { projectId: 999 })).items.map((i) => i.kind)).toEqual(["digest"]);
  });

  it("one weekly digest per ISO week; settings can turn rules off", async () => {
    await runRules(1, { now: monday, force: true });
    await runRules(1, { now: monday + 86_400_000, force: true });
    expect((await listNotifications(1)).items.filter((i) => i.kind === "digest")).toHaveLength(1);
    await saveSettings(1, { performance: { enabled: false } });
    await saveSection(1, gsc(600, 1000), "a");
    expect((await runRules(1, { now: monday + 2 * 86_400_000, force: true })).created).toBe(0);
  });
});

describe("docs", () => {
  // Owner decision 2026-10-17: exactly these two logins publish (a listed address that isn't a team login can't).
  const env = { DOCS_ADMIN_EMAILS: "tin@artemisdigital.com,tinledoihoa@gmail.com, stranger@example.com", VERCEL_ENV: "preview" };
  const admin = { id: 1, email: "tinledoihoa@gmail.com" };
  const analytics = { id: 3, email: "analytics@artemisdigital.com" };

  it("admins are explicit, matched on a verified linked login of an active team member", async () => {
    expect(emailIsDocsAdmin(" Tin@ArtemisDigital.com ", env)).toBe(true);
    expect(await isDocsAdmin({ id: 1 }, env)).toBe(true);
    expect(await isDocsAdmin({ id: 5 }, env)).toBe(true);
    expect(await isDocsAdmin({ id: 2 }, env)).toBe(false); // a team member, not a publisher
    expect(await isDocsAdmin({ id: 3 }, env)).toBe(false); // the shared analytics account has no login
    expect(await isDocsAdmin({ id: 4 }, env)).toBe(false); // listed, but not in the workspace
    expect(await isDocsAdmin({ id: 1 }, {})).toBe(false);
    // Linking Tin's company login to his profile keeps publishing with the same profile.
    await pg.exec("UPDATE user_identities SET user_id = 1 WHERE subject = 's5'");
    try {
      expect(await isDocsAdmin({ id: 1 }, { DOCS_ADMIN_EMAILS: "tin@artemisdigital.com" })).toBe(true);
    } finally {
      await pg.exec("UPDATE user_identities SET user_id = 5 WHERE subject = 's5'");
    }
    await pg.exec("UPDATE users SET status = 'disabled' WHERE id = 1");
    try {
      expect(await isDocsAdmin({ id: 1 }, env)).toBe(false);
    } finally {
      await pg.exec("UPDATE users SET status = 'active' WHERE id = 1");
    }
  });

  it("drafts are hidden from readers; only admins write and publish; publishing notifies each person once", async () => {
    await expect(saveArticle(analytics, { title: "x" }, env)).rejects.toBeInstanceOf(DocsForbidden);
    await expect(saveArticle({ id: 2, email: "colleague@headsonpillows.com" }, { title: "x" }, env)).rejects.toBeInstanceOf(DocsForbidden);
    const a = await saveArticle(admin, { title: "Rank tracking guide", summary: "How to read rankings", body: "## Hi" }, env);
    expect(a).toMatchObject({ slug: "rank-tracking-guide", status: "draft" });
    expect(await getArticle(a.slug, { admin: false })).toBeNull();
    expect((await listArticles({ admin: false })).map((x) => x.slug)).toEqual([]);
    await expect(setPublished(analytics, a.id, true, env)).rejects.toBeInstanceOf(DocsForbidden);
    await setPublished(admin, a.id, true, env);
    await setPublished(admin, a.id, false, env);
    await setPublished(admin, a.id, true, env);
    expect((await getArticle(a.slug, { admin: false }))?.status).toBe("published");
    expect((await listNotifications(1)).items.filter((i) => i.kind === "docs")).toMatchObject([{ title: "New in Docs: Rank tracking guide", href: "/docs/rank-tracking-guide" }]);
    expect((await listNotifications(2)).items.filter((i) => i.kind === "docs")).toHaveLength(1);
    const outside = await pg.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM notifications WHERE user_id IN (3, 4)");
    expect(outside.rows[0].n).toBe(0); // the analytics connection and people outside the workspace get nothing
  });

  it("both authorized publishers can publish a test article; another team member can't", async () => {
    for (const who of [{ id: 5, email: "tin@artemisdigital.com" }, admin]) {
      const a = await saveArticle(who, { title: `Temporary test (${who.id})`, summary: "Temporary test document", body: "Remove me." }, env);
      expect((await setPublished(who, a.id, true, env)).status).toBe("published");
      await expect(setPublished({ id: 2, email: "colleague@headsonpillows.com" }, a.id, false, env)).rejects.toBeInstanceOf(DocsForbidden);
      expect((await getArticle(a.slug, { admin: false }))?.status).toBe("published"); // other team members still read it
    }
    await pg.query("DELETE FROM doc_articles WHERE title LIKE 'Temporary test%'");
  });

  it("demo examples exist only outside Production, are labelled and can't be published or edited", async () => {
    await ensureDemoDocs({ VERCEL_ENV: "production" });
    expect(await listArticles({ admin: true })).toHaveLength(0);
    await ensureDemoDocs({ VERCEL_ENV: "preview" });
    await ensureDemoDocs({ VERCEL_ENV: "preview" });
    const docs = await listArticles({ admin: false });
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.demo)).toBe(true);
    await expect(setPublished(admin, docs[0].id, true, env)).rejects.toThrow();
    await expect(saveArticle(admin, { title: "x", slug: "demo-mine" }, env)).rejects.toThrow("reserved");
    expect((await pg.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM notifications")).rows[0].n).toBe(0);
  });
});
