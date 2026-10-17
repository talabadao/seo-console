// Rank tracking → Organic SERP: engine-valid parameters, explicit runs with a fake SerpApi (never the real one),
// no duplicate billable calls (one-hour reuse, joining an identical run in flight), depth and stop-on-found,
// partial runs never marked complete, refused runs not stored, snapshots read without searching, saved searches,
// and comparisons. Real schema on PGlite.
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
import { SerpInputError, diffSnapshots, maxRequests, normalizeInput, requestParams } from "@/lib/organicSerp/engines";
import { REUSE_MS, RunRefused, deleteConfig, getSnapshot, listConfigs, listSnapshots, runSearch, saveConfig, type PageSearch } from "@/lib/organicSerp/store";
import { SerpRefused } from "@/lib/providers/serpapi";

const project = { id: 1, websiteUrl: "https://www.wewine.vn/" };

/** A fake SerpApi: 10 organic results per page; the site at `sitePos` (1-based overall); counts calls. */
function fakeSerp(opts: { sitePos?: number; pages?: number; failOnPage?: number; refuse?: boolean; delayMs?: number } = {}) {
  const calls: Record<string, string>[] = [];
  const search: PageSearch = async (params) => {
    calls.push(params);
    const page = params.start ? Number(params.start) / 10 + 1 : params.first ? (Number(params.first) - 1) / 10 + 1 : params.p ? Number(params.p) + 1 : Number(params.page ?? 1);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.refuse) throw new SerpRefused("Limit reached");
    if (opts.failOnPage === page) throw new Error("SerpApi google: HTTP 500");
    const organic = Array.from({ length: 10 }, (_, i) => {
      const pos = (page - 1) * 10 + i + 1;
      const host = pos === opts.sitePos ? "wewine.vn" : `site${pos}.example`;
      return { position: i + 1, title: `Result ${pos}`, link: `https://${host}/p${pos}`, snippet: `Snippet ${pos}` };
    });
    return { organic_results: organic, related_questions: page === 1 ? [{}] : undefined, serpapi_pagination: page < (opts.pages ?? 10) ? { next: "x" } : undefined };
  };
  return { calls, search };
}

const input = (over: Record<string, unknown> = {}) =>
  normalizeInput({ engine: "google", params: { query: "rượu vang", location: "Ho Chi Minh City, Vietnam", country: "vn", language: "vi", device: "desktop" }, depth: 30, stopOnFound: false, ...over });

beforeAll(async () => {
  for (const s of BASELINE_STATEMENTS) await pg.exec(s);
  for (const m of MIGRATIONS.slice(1)) for (const s of m.statements) await pg.exec(s);
  await pg.exec(`INSERT INTO users (email, created_at, updated_at) VALUES ('one@example.com', 0, 0), ('two@example.com', 0, 0);
    INSERT INTO projects (id, user_id, name, website_url, created_at, updated_at) VALUES (1, 1, 'Wewine', 'https://www.wewine.vn/', 0, 0), (2, 2, 'Theirs', 'https://other.example/', 0, 0);`);
});
beforeEach(async () => {
  await pg.exec("DELETE FROM serp_snapshots; DELETE FROM serp_configs;");
});

describe("engines", () => {
  it("keeps only each engine's controls and maps them to SerpApi parameters", () => {
    const y = normalizeInput({ engine: "yandex", params: { query: "вино", location: "Moscow", device: "mobile", yandexDomain: "yandex.ru", language: "ru", region: "213" }, depth: 20 });
    expect(y.params).toEqual({ query: "вино", yandexDomain: "yandex.ru", language: "ru", region: "213" });
    expect(requestParams(y, 2)).toEqual({ engine: "yandex", text: "вино", yandex_domain: "yandex.ru", lang: "ru", lr: "213", p: "1" });
    const n = normalizeInput({ engine: "naver", params: { query: "와인", location: "Seoul", device: "mobile" }, depth: 10 });
    expect(requestParams(n, 1)).toEqual({ engine: "naver", query: "와인", device: "mobile" });
    expect(requestParams(input(), 3)).toMatchObject({ engine: "google", q: "rượu vang", gl: "vn", hl: "vi", start: "20" });
    const b = normalizeInput({ engine: "bing", params: { query: "wine", country: "US", language: "en" }, depth: 20 });
    expect(requestParams(b, 2)).toEqual({ engine: "bing", q: "wine", cc: "us", first: "11" });
    expect(maxRequests("google", 50)).toBe(5);
    expect(() => normalizeInput({ engine: "google", params: { query: "" }, depth: 10 })).toThrow(SerpInputError);
    expect(() => normalizeInput({ engine: "naver", params: { query: "x" }, depth: 50 })).toThrow(SerpInputError);
    expect(() => normalizeInput({ engine: "duckduckgo", params: { query: "x" }, depth: 10 })).toThrow(SerpInputError);
  });
});

describe("runs", () => {
  it("scans to the depth, renumbers across pages and finds the site", async () => {
    const f = fakeSerp({ sitePos: 14 });
    const { snapshot } = await runSearch({ userId: 1, project, input: input(), search: f.search });
    expect(f.calls).toHaveLength(3);
    expect(snapshot).toMatchObject({ status: "done", requests: 3, scanned: 30, trackedDomain: "wewine.vn", trackedPosition: 14, trackedUrl: "https://wewine.vn/p14" });
    expect(snapshot.results.map((r) => r.position)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(snapshot.features).toEqual(["People also ask"]);
    expect(f.calls.every((c) => !("api_key" in c))).toBe(true);
  });

  it("stops when the site is found, saving searches", async () => {
    const f = fakeSerp({ sitePos: 4 });
    const { snapshot } = await runSearch({ userId: 1, project, input: input({ stopOnFound: true, depth: 50 }), search: f.search });
    expect(f.calls).toHaveLength(1);
    expect(snapshot).toMatchObject({ requests: 1, scanned: 10, trackedPosition: 4 });
  });

  it("says not found within the depth actually scanned", async () => {
    const f = fakeSerp({ pages: 2 });
    const { snapshot } = await runSearch({ userId: 1, project, input: input({ depth: 50 }), search: f.search });
    expect(f.calls).toHaveLength(2); // no next page after 2
    expect(snapshot).toMatchObject({ status: "done", scanned: 20, depth: 50, trackedPosition: null });
  });

  it("an identical search from the last hour is reused without a new call; force searches again", async () => {
    const f = fakeSerp({ sitePos: 5 });
    const first = await runSearch({ userId: 1, project, input: input(), search: f.search });
    const again = await runSearch({ userId: 1, project, input: input(), search: f.search });
    expect(again.reused).toBe(true);
    expect(again.snapshot.id).toBe(first.snapshot.id);
    expect(f.calls).toHaveLength(3);
    // Different settings are a different search.
    await runSearch({ userId: 1, project, input: input({ params: { query: "rượu vang", device: "mobile" } }), search: f.search });
    expect(f.calls).toHaveLength(6);
    const forced = await runSearch({ userId: 1, project, input: input(), search: f.search, force: true });
    expect(forced.reused).toBeUndefined();
    expect(f.calls).toHaveLength(9);
    // After an hour it's not reused.
    await pg.query("UPDATE serp_snapshots SET started_at = started_at - $1", [REUSE_MS + 1000]);
    expect((await runSearch({ userId: 1, project, input: input(), search: f.search })).reused).toBeUndefined();
  });

  it("concurrent identical runs make one set of calls (the others join)", async () => {
    const f = fakeSerp({ sitePos: 12, delayMs: 50 });
    const runs = await Promise.all(Array.from({ length: 5 }, () => runSearch({ userId: 1, project, input: input(), search: f.search })));
    expect(f.calls).toHaveLength(3);
    expect(new Set(runs.map((r) => r.snapshot.id)).size).toBe(1);
    expect(runs.filter((r) => r.joined)).toHaveLength(4);
  });

  it("a failure after the first page keeps the pages it got, marked partial", async () => {
    const f = fakeSerp({ failOnPage: 2 });
    const { snapshot } = await runSearch({ userId: 1, project, input: input(), search: f.search });
    expect(snapshot).toMatchObject({ status: "partial", scanned: 10, requests: 2, trackedPosition: null });
    expect(snapshot.error).toContain("HTTP 500");
    // A partial run is never reused as if complete.
    const again = await runSearch({ userId: 1, project, input: input(), search: fakeSerp().search });
    expect(again.reused).toBeUndefined();
  });

  it("a refused run sends nothing and leaves no snapshot", async () => {
    const f = fakeSerp({ refuse: true });
    await expect(runSearch({ userId: 1, project, input: input(), search: f.search })).rejects.toBeInstanceOf(RunRefused);
    expect(await listSnapshots(1, 1)).toHaveLength(0);
  });

  it("an interrupted run doesn't block identical runs forever", async () => {
    await pg.query(
      `INSERT INTO serp_snapshots (user_id, project_id, engine, params, params_hash, depth, stop_on_found, status, started_at)
       SELECT 1, 1, 'google', '{}'::jsonb, $1, 30, false, 'running', $2`,
      [(await import("@/lib/organicSerp/store")).paramsHash(input()), Date.now() - 10 * 60_000],
    );
    const f = fakeSerp();
    const r = await runSearch({ userId: 1, project, input: input(), search: f.search });
    expect(r.joined).toBeUndefined();
    expect(f.calls).toHaveLength(3);
    expect((await listSnapshots(1, 1)).map((s) => s.status).sort()).toEqual(["done", "failed"]);
  });

  it("demo projects get labelled demo results with no SerpApi call", async () => {
    const f = fakeSerp();
    const { snapshot } = await runSearch({ userId: 2, project: { id: 2, websiteUrl: "https://other.example/" }, input: input({ depth: 20 }), search: f.search });
    expect(f.calls).toHaveLength(0);
    expect(snapshot).toMatchObject({ demo: true, requests: 0, status: "done" });
    expect(snapshot.results[0].title).toContain("(demo)");
  });
});

describe("history, saved searches and comparison", () => {
  it("snapshots belong to their project (readable by everyone who can view it) and open without searching", async () => {
    const f = fakeSerp({ sitePos: 3 });
    const { snapshot } = await runSearch({ userId: 1, project, input: input(), search: f.search });
    const calls = f.calls.length;
    expect((await getSnapshot(1, 1, snapshot.id))?.results).toHaveLength(30);
    // A completed result is project data: another team member viewing the project reads the same snapshot.
    expect((await getSnapshot(2, 1, snapshot.id))?.id).toBe(snapshot.id);
    expect(await getSnapshot(1, 2, snapshot.id)).toBeNull();
    expect(f.calls.length).toBe(calls);
  });

  it("saves, updates and deletes searches without searching", async () => {
    const c = await saveConfig(1, 1, "Main keyword", input());
    await saveConfig(1, 1, "Main keyword (mobile)", input({ params: { query: "rượu vang", device: "mobile" } }), c.id);
    expect((await listConfigs(1, 1)).map((x) => [x.name, x.params.device])).toEqual([["Main keyword (mobile)", "mobile"]]);
    expect(await listConfigs(2, 1)).toEqual([]);
    expect(await deleteConfig(2, 1, c.id)).toBe(false);
    expect(await deleteConfig(1, 1, c.id)).toBe(true);
  });

  it("compares two snapshots by URL", () => {
    const r = (pos: number, host: string, path: string) => ({ position: pos, title: path, url: `https://${host}/${path}`, displayedUrl: null, domain: host, snippet: null });
    const diff = diffSnapshots([r(1, "a.com", "x"), r(2, "wewine.vn", "home"), r(3, "b.com", "y")], [r(1, "wewine.vn", "home"), r(2, "a.com", "x"), r(3, "c.com", "z")], "wewine.vn");
    expect(diff.map((d) => [d.domain, d.a, d.b, d.change, d.tracked])).toEqual([
      ["wewine.vn", 2, 1, 1, true],
      ["a.com", 1, 2, -1, false],
      ["c.com", null, 3, null, false],
      ["b.com", 3, null, null, false],
    ]);
  });
});
