// In-app notifications and Docs: rules only fire on live, complete, non-demo saved results above thresholds and
// minimum volumes; dedupe by rule + project + period; read/unread per account; project filter; weekly digest
// once per week; Docs drafts and publishing only for explicit admins; demo examples never notify.
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
import { listNotifications, markRead, runRules, saveSettings } from "@/lib/notifications/store";
import { DocsForbidden, ensureDemoDocs, getArticle, isDocsAdmin, listArticles, saveArticle, setPublished } from "@/lib/docs/store";

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
  await pg.exec(`INSERT INTO users (email, created_at, updated_at) VALUES ('tinledoihoa@gmail.com', 0, 0), ('analytics@artemisdigital.com', 0, 0), ('stranger@example.com', 0, 0);
    INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (1, 1, 'Wewine', 0, 0), (2, 2, 'Theirs', 0, 0);`);
});
beforeEach(async () => {
  await pg.exec("DELETE FROM notifications; DELETE FROM notification_settings; DELETE FROM report_cache; DELETE FROM doc_articles;");
});

const saveSection = async (userId: number, s: CachedSection, key: string) =>
  pg.query(
    `INSERT INTO report_cache (scope, cache_key, kind, provider, user_id, project_id, query, payload, fetched_at, fresh_until) VALUES ($1, $2, $3, 'gsc', $4, $5, $6, $7, $8, $9)`,
    [`user:${userId}`, key, s.kind, userId, s.projectId, JSON.stringify(s.query), JSON.stringify(s.payload), Date.now(), Date.now() + 1e6],
  );

describe("store", () => {
  const sunday = Date.parse("2026-10-18T12:00:00Z"); // no digest on Sundays
  const monday = Date.parse("2026-10-19T12:00:00Z");

  it("creates from saved results once, per account, and throttles runs", async () => {
    await saveSection(1, gsc(600, 1000), "a");
    await saveSection(1, gsc(600, 1000), "b"); // same period saved twice
    await saveSection(2, { ...gsc(600, 1000), projectId: 2 }, "c"); // another account's data in its own scope
    expect(await runRules(1, { now: sunday })).toEqual({ ran: true, created: 1 });
    expect(await runRules(1, { now: sunday + 60_000 })).toEqual({ ran: false, created: 0 });
    expect((await runRules(1, { now: sunday + 60_000, force: true })).created).toBe(0);
    const list = await listNotifications(1);
    expect(list.unread).toBe(1);
    expect(list.items[0]).toMatchObject({ projectId: 1, projectName: "Wewine", kind: "performance", href: "/p/1/search-console/performance" });
    expect((await listNotifications(2)).items).toHaveLength(0);
  });

  it("never reads another account's cache rows for its projects", async () => {
    // A row in account 2's scope for project 1 (owned by account 1) is ignored for both.
    await saveSection(2, gsc(600, 1000), "x");
    expect((await runRules(1, { now: sunday })).created).toBe(0);
    expect((await runRules(2, { now: sunday })).created).toBe(0);
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
  // Owner decision 2026-10-17: exactly these two accounts publish (a third allowed account, and anyone off the allowlist, can't).
  const env = { DOCS_ADMIN_EMAILS: "tin@artemisdigital.com,tinledoihoa@gmail.com, stranger@example.com", VERCEL_ENV: "preview" };
  const admin = { id: 1, email: "tinledoihoa@gmail.com" };

  it("admins are explicit and must be allowed to sign in", () => {
    expect(isDocsAdmin("tinledoihoa@gmail.com", env)).toBe(true);
    expect(isDocsAdmin("tin@artemisdigital.com", env)).toBe(true);
    expect(isDocsAdmin(" Tin@ArtemisDigital.com ", env)).toBe(true);
    for (const other of ["analytics@artemisdigital.com", "analytics@headsonpillows.com", "tin@headsonpillows.com"]) expect(isDocsAdmin(other, env), other).toBe(false); // allowed to sign in, not publishers
    expect(isDocsAdmin("stranger@example.com", env)).toBe(false); // listed but not on the allowlist
    expect(isDocsAdmin("tinledoihoa@gmail.com", {})).toBe(false);
  });

  it("drafts are hidden from readers; only admins write and publish; publishing notifies each account once", async () => {
    await expect(saveArticle({ id: 2, email: "analytics@artemisdigital.com" }, { title: "x" }, env)).rejects.toBeInstanceOf(DocsForbidden);
    const a = await saveArticle(admin, { title: "Rank tracking guide", summary: "How to read rankings", body: "## Hi" }, env);
    expect(a).toMatchObject({ slug: "rank-tracking-guide", status: "draft" });
    expect(await getArticle(a.slug, { admin: false })).toBeNull();
    expect((await listArticles({ admin: false })).map((x) => x.slug)).toEqual([]);
    await expect(setPublished({ id: 2, email: "analytics@artemisdigital.com" }, a.id, true, env)).rejects.toBeInstanceOf(DocsForbidden);
    await setPublished(admin, a.id, true, env);
    await setPublished(admin, a.id, false, env);
    await setPublished(admin, a.id, true, env);
    expect((await getArticle(a.slug, { admin: false }))?.status).toBe("published");
    const n1 = await listNotifications(1);
    const n2 = await listNotifications(2);
    expect(n1.items.filter((i) => i.kind === "docs")).toMatchObject([{ title: "New in Docs: Rank tracking guide", href: "/docs/rank-tracking-guide" }]);
    expect(n2.items.filter((i) => i.kind === "docs")).toHaveLength(1);
    const stranger = await pg.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = 3");
    expect(stranger.rows[0].n).toBe(0); // not on the allowlist
  });

  it("both authorized publishers can publish a test article; a third allowed account can't", async () => {
    await pg.query("INSERT INTO users (id, email, created_at, updated_at) VALUES (4, 'tin@artemisdigital.com', 0, 0) ON CONFLICT DO NOTHING");
    for (const who of [{ id: 4, email: "tin@artemisdigital.com" }, admin]) {
      const a = await saveArticle(who, { title: `Temporary test (${who.id})`, summary: "Temporary test document", body: "Remove me." }, env);
      expect((await setPublished(who, a.id, true, env)).status).toBe("published");
      await expect(setPublished({ id: 2, email: "analytics@artemisdigital.com" }, a.id, false, env)).rejects.toBeInstanceOf(DocsForbidden);
      expect((await getArticle(a.slug, { admin: false }))?.status).toBe("published"); // other allowed accounts still read it
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
