// Incremental Search Console daily totals (lib/gscDaily.ts) and scheduled-run history (lib/cronRuns.ts), on the
// real schema (baseline + every migration, PGlite). A fake Search Console records each requested window: a warm
// read makes no request, a refresh asks only for missing and still-revisable days, revised days overwrite (never
// double count), withdrawn days disappear, and each account's site keeps its own rows.
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
import { OVERLAP_DAYS, REVISE_AFTER_MS, foldDays, gscDailyTotals, mergeCoverage, plan, type DateWindow } from "@/lib/gscDaily";
import { MAX_ROWS, RETAIN_DAYS, cronFinish, cronStart, recentCronRuns, recordCron, sanitizeError } from "@/lib/cronRuns";
import type { SearchAnalyticsRow } from "@/lib/google/searchconsole";

const PROPERTY = "sc-domain:gocsandeal.com";
const at = (ymd: string, hour = 12) => Date.parse(`${ymd}T${String(hour).padStart(2, "0")}:00:00Z`);

/** A fake Search Console: one row per day from `values` (date -> clicks); records the requested windows. */
function fakeGsc(values: Map<string, number>) {
  const calls: DateWindow[] = [];
  const fetch = async (w: DateWindow): Promise<SearchAnalyticsRow[]> => {
    calls.push(w);
    const out: SearchAnalyticsRow[] = [];
    for (const [date, clicks] of values) {
      if (date >= w.start && date <= w.end) out.push({ keys: [date], clicks, impressions: clicks * 10, ctr: 0.1, position: 5 });
    }
    return out;
  };
  return { calls, fetch };
}

function days(start: string, end: string, clicks = 1) {
  const m = new Map<string, number>();
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) m.set(new Date(t).toISOString().slice(0, 10), clicks);
  return m;
}

beforeAll(async () => {
  for (const s of BASELINE_STATEMENTS) await pg.exec(s);
  for (const m of MIGRATIONS.slice(1)) for (const s of m.statements) await pg.exec(s);
  await pg.exec(`INSERT INTO users (id, email, created_at, updated_at) VALUES (1, 'a@example.com', 0, 0), (2, 'b@example.com', 0, 0), (3, 'c@example.com', 0, 0);
    INSERT INTO sites (id, user_id, source, property, created_at) VALUES (10, 1, 'google', '${PROPERTY}', 0), (20, 2, 'google', '${PROPERTY}', 0);`);
});

describe("refresh planning", () => {
  const now = at("2026-10-17");
  it("fetches the whole range the first time", () => {
    expect(plan({ start: "2026-09-01", end: "2026-10-16" }, null, now)).toEqual({ windows: [{ start: "2026-09-01", end: "2026-10-16" }], refreshesTail: true });
  });
  it("fetches nothing for a covered range whose revisable tail was refreshed recently", () => {
    const cov = { from: "2026-08-01", to: "2026-10-16", refreshedAt: now - 60_000 };
    expect(plan({ start: "2026-09-01", end: "2026-10-16" }, cov, now).windows).toEqual([]);
  });
  it("refetches only the revisable tail once it is due", () => {
    const cov = { from: "2026-08-01", to: "2026-10-16", refreshedAt: at("2026-10-16") };
    const p = plan({ start: "2026-09-01", end: "2026-10-16" }, cov, at("2026-10-16") + REVISE_AFTER_MS);
    expect(p.windows).toEqual([{ start: `2026-10-${16 - (OVERLAP_DAYS - 1)}`, end: "2026-10-16" }]);
  });
  it("needs no request for a historical range, however old the last refresh", () => {
    const cov = { from: "2026-01-01", to: "2026-10-16", refreshedAt: at("2026-10-16") };
    expect(plan({ start: "2026-03-01", end: "2026-03-31" }, cov, at("2026-12-01")).windows).toEqual([]);
  });
  it("extends backwards by the gap only, and forwards from the revisable tail", () => {
    const cov = { from: "2026-08-01", to: "2026-10-10", refreshedAt: at("2026-10-10") };
    expect(plan({ start: "2026-07-01", end: "2026-10-16" }, cov, at("2026-10-17")).windows).toEqual([
      { start: "2026-07-01", end: "2026-07-31" },
      { start: "2026-10-07", end: "2026-10-16" },
    ]);
  });
});

describe("incremental Search Console daily totals", () => {
  beforeEach(async () => {
    await pg.exec("DELETE FROM perf_rows; DELETE FROM gsc_daily_coverage;");
  });

  it("stores the first refresh, then serves warm reads with no request", async () => {
    const gsc = fakeGsc(days("2026-09-01", "2026-10-15", 2));
    const range = { start: "2026-09-01", end: "2026-10-16" };
    const first = await gscDailyTotals(10, PROPERTY, range, gsc.fetch, at("2026-10-17"));
    expect(gsc.calls).toEqual([range]);
    expect(first!.days).toHaveLength(45);
    const again = await gscDailyTotals(10, PROPERTY, range, gsc.fetch, at("2026-10-17") + 60_000);
    expect(gsc.calls).toHaveLength(1);
    expect(again!.fetched).toEqual([]);
    expect(again!.days).toEqual(first!.days);
  });

  it("refreshes only the overlap window, overwriting revisions and removing withdrawn days without double counting", async () => {
    const values = days("2026-09-01", "2026-10-15", 2);
    const gsc = fakeGsc(values);
    const range = { start: "2026-09-01", end: "2026-10-16" };
    await gscDailyTotals(10, PROPERTY, range, gsc.fetch, at("2026-10-16"));
    values.set("2026-10-14", 7); // Google revised a recent day
    values.delete("2026-10-15"); // ...and withdrew another
    values.set("2026-10-16", 3); // a new day arrived
    const later = await gscDailyTotals(10, PROPERTY, range, gsc.fetch, at("2026-10-17"));
    expect(gsc.calls[1]).toEqual({ start: "2026-10-13", end: "2026-10-16" });
    const byDate = new Map(later!.days.map((d) => [d.date, d.clicks]));
    expect(byDate.get("2026-10-14")).toBe(7);
    expect(byDate.has("2026-10-15")).toBe(false);
    expect(byDate.get("2026-10-16")).toBe(3);
    const dupes = await pg.query("SELECT data_date FROM perf_rows WHERE site_id = 10 AND dimension = 'total' GROUP BY data_date HAVING COUNT(*) > 1");
    expect(dupes.rows).toEqual([]);
    expect(foldDays(later!.days, range).clicks).toBe(43 * 2 + 7 + 3);
  });

  it("fetches only the missing earlier days when a longer range is requested", async () => {
    const gsc = fakeGsc(days("2026-06-01", "2026-10-15"));
    await gscDailyTotals(10, PROPERTY, { start: "2026-09-01", end: "2026-10-16" }, gsc.fetch, at("2026-10-17"));
    const wider = await gscDailyTotals(10, PROPERTY, { start: "2026-07-01", end: "2026-10-16" }, gsc.fetch, at("2026-10-17") + 60_000);
    expect(gsc.calls[1]).toEqual({ start: "2026-07-01", end: "2026-08-31" });
    expect(wider!.days).toHaveLength(107);
    const cov = await pg.query<{ covered_from: string; covered_to: string }>("SELECT covered_from, covered_to FROM gsc_daily_coverage WHERE site_id = 10");
    expect(cov.rows[0]).toEqual({ covered_from: "2026-07-01", covered_to: "2026-10-16" });
  });

  it("two concurrent first refreshes of distant periods don't claim the days between them", async () => {
    const gsc = fakeGsc(days("2026-01-01", "2026-10-15"));
    const now = at("2026-10-17");
    await Promise.all([
      gscDailyTotals(10, PROPERTY, { start: "2026-09-01", end: "2026-10-15" }, gsc.fetch, now),
      gscDailyTotals(10, PROPERTY, { start: "2026-02-01", end: "2026-02-28" }, gsc.fetch, now),
    ]);
    const cov = (await pg.query<{ covered_from: string; covered_to: string }>("SELECT covered_from, covered_to FROM gsc_daily_coverage WHERE site_id = 10")).rows[0];
    // One of the two ranges is recorded; never a range spanning March–August, which nobody fetched.
    expect([
      { covered_from: "2026-09-01", covered_to: "2026-10-15" },
      { covered_from: "2026-02-01", covered_to: "2026-02-28" },
    ]).toContainEqual(cov);
    const calls = gsc.calls.length;
    const summer = await gscDailyTotals(10, PROPERTY, { start: "2026-06-01", end: "2026-06-30" }, gsc.fetch, now + 60_000);
    expect(gsc.calls.length).toBeGreaterThan(calls); // the gap is fetched, not served as empty
    expect(summer!.days).toHaveLength(30);
  });

  it("merges coverage only when ranges touch", () => {
    const cur = { from: "2026-09-01", to: "2026-09-30", refreshedAt: 5 };
    expect(mergeCoverage(cur, { from: "2026-10-01", to: "2026-10-10" }, 9)).toEqual({ from: "2026-09-01", to: "2026-10-10", refreshedAt: 9 });
    expect(mergeCoverage(cur, { from: "2026-08-01", to: "2026-08-31" }, null)).toEqual({ from: "2026-08-01", to: "2026-09-30", refreshedAt: 5 });
    expect(mergeCoverage(cur, { from: "2026-11-01", to: "2026-11-05" }, 9)).toBeNull();
  });

  it("keeps each connection's copy of the same property separate", async () => {
    const a = fakeGsc(days("2026-10-01", "2026-10-15", 5));
    const b = fakeGsc(days("2026-10-01", "2026-10-15", 9));
    const range = { start: "2026-10-01", end: "2026-10-15" };
    await gscDailyTotals(10, PROPERTY, range, a.fetch, at("2026-10-17"));
    const forB = await gscDailyTotals(20, PROPERTY, range, b.fetch, at("2026-10-17"));
    expect(b.calls).toHaveLength(1); // connection B's stored rows don't come from connection A's refresh
    expect(forB!.days.every((d) => d.clicks === 9)).toBe(true);
    const forA = await gscDailyTotals(10, PROPERTY, range, a.fetch, at("2026-10-17") + 60_000);
    expect(forA!.days.every((d) => d.clicks === 5)).toBe(true);
    // No stored site row for the property (not discovered by the mapped connection): the direct queries are used.
    expect(await gscDailyTotals(null, PROPERTY, range, a.fetch)).toBeNull();
  });

  it("derives CTR from clicks and impressions and weights position by impressions", () => {
    const r = foldDays(
      [
        { date: "2026-10-01", clicks: 10, impressions: 100, ctr: 0.1, position: 2 },
        { date: "2026-10-02", clicks: 0, impressions: 300, ctr: 0, position: 10 },
      ],
      { start: "2026-10-01", end: "2026-10-31" },
    );
    expect(r).toMatchObject({ clicks: 10, impressions: 400, ctr: 0.025, position: 8 });
    expect(foldDays([], { start: "2026-10-01", end: "2026-10-31" })).toMatchObject({ clicks: 0, ctr: null, position: null, rows: 0 });
  });
});

describe("scheduled-run history", () => {
  it("redacts connection strings, tokens, keys and email addresses from errors", () => {
    const s = sanitizeError(
      new Error("connect postgresql://owner:pw@host/db failed; Bearer abc.def; https://x?api_key=SECRET1&q=1 for someone@example.com; token " + "a".repeat(40)),
    );
    expect(s).not.toMatch(/owner:pw|abc\.def|SECRET1|someone@example\.com|a{40}/);
    expect(s.length).toBeLessThanOrEqual(300);
  });

  it("records an authenticated run with its counts and duration, and a failure with a sanitized error", async () => {
    const out = await recordCron("sync", async () => ({ status: "ok" as const, processed: 3, queued: 5, skipped: 1, details: { failed: 0 } }));
    expect(out.processed).toBe(3);
    await expect(recordCron("pagespeed", async () => Promise.reject(new Error("boom postgres://u:p@h/d")))).rejects.toThrow("boom");
    const runs = (await recentCronRuns(10))!;
    const ok = runs.find((r) => r.job === "sync")!;
    expect(ok).toMatchObject({ status: "ok", processed: 3, queued: 5, skipped: 1, details: { failed: 0 }, error: null });
    expect(ok.durationMs).toBeGreaterThanOrEqual(0);
    const bad = runs.find((r) => r.job === "pagespeed")!;
    expect(bad.status).toBe("error");
    expect(bad.error).toContain("boom");
    expect(bad.error).not.toContain("u:p@h");
  });

  it("keeps a bounded history", async () => {
    await pg.query("INSERT INTO cron_runs (job, started_at, status) VALUES ('old', $1, 'ok')", [Date.now() - (RETAIN_DAYS + 1) * 86_400_000]);
    await pg.query("INSERT INTO cron_runs (job, started_at, status) SELECT 'bulk', $1, 'ok' FROM generate_series(1, $2::int)", [Date.now(), MAX_ROWS + 50]);
    await cronFinish(await cronStart("sync"), { status: "ok" });
    const n = await pg.query<{ n: number; old: number }>("SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE job = 'old')::int AS old FROM cron_runs");
    expect(n.rows[0].old).toBe(0);
    expect(n.rows[0].n).toBe(MAX_ROWS);
  });

  it("is a no-op before migration 0012", async () => {
    await pg.exec("DROP TABLE cron_runs; DROP TABLE gsc_daily_coverage;");
    expect(await cronStart("sync")).toBeNull();
    await expect(recordCron("sync", async () => ({ status: "ok" as const }))).resolves.toEqual({ status: "ok" });
    expect(await recentCronRuns()).toBeNull();
    expect(await gscDailyTotals(10, PROPERTY, { start: "2026-10-01", end: "2026-10-02" }, async () => [])).toBeNull();
  });
});
