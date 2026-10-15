import { describe, expect, it } from "vitest";
import { pctChange, resolvePeriod, taskMonth } from "@/lib/v2/summary/period";
import { summarizeTasks, type RawTask } from "@/lib/v2/summary/tasks";
import { alertsFor, meetsKpi, needsAttention } from "@/lib/v2/summary/alerts";
import { demoSummary, isDemoWebsite } from "@/lib/v2/summary/demo";
import { ALL_PARTS, type ProjectSummary } from "@/lib/v2/summary/types";
import { cacheGet, cacheSet, cacheClear } from "@/lib/v2/summary/cache";

const NOW = new Date("2026-10-15T09:00:00Z");

describe("periods", () => {
  it("ends yesterday and compares with the window just before", () => {
    const p = resolvePeriod("last28", "previous", NOW);
    expect(p.current).toEqual({ start: "2026-09-17", end: "2026-10-14" });
    expect(p.previous).toEqual({ start: "2026-08-20", end: "2026-09-16" });
  });

  it("compares last month with the whole month before, and year-over-year by date", () => {
    expect(resolvePeriod("lastMonth", "previous", NOW).current).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(resolvePeriod("lastMonth", "previous", NOW).previous).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(resolvePeriod("last7", "yoy", NOW).previous).toEqual({ start: "2025-10-08", end: "2025-10-14" });
    expect(resolvePeriod("last7", "none", NOW).previous).toBeNull();
  });

  it("states the task month explicitly", () => {
    expect(taskMonth(NOW)).toEqual({ yearMonth: "2026-10", monthStart: "2026-10-01", monthEnd: "2026-10-31", today: "2026-10-15" });
  });

  it("returns no change when a side is missing or the base is zero, instead of 0% or infinity", () => {
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(null, 100)).toBeNull();
    expect(pctChange(5, 0)).toBeNull();
  });
});

describe("monthly task counts", () => {
  const month = taskMonth(NOW);
  const t = (gid: string, o: Partial<RawTask>): RawTask => ({
    gid,
    name: gid,
    completed: false,
    completed_at: null,
    due_on: null,
    assignee: null,
    permalink_url: null,
    ...o,
  });
  const tasks = [
    t("done-this-month-due-last-month", { completed: true, completed_at: "2026-10-03T08:00:00Z", due_on: "2026-09-28" }),
    t("done-this-month-due-this-month", { completed: true, completed_at: "2026-10-10T08:00:00Z", due_on: "2026-10-12" }),
    t("overdue", { due_on: "2026-10-01" }),
    t("overdue-from-last-month", { due_on: "2026-09-20" }),
    t("due-later-this-month", { due_on: "2026-10-20" }),
    t("due-next-month", { due_on: "2026-11-02" }),
    t("no-date", {}),
  ];
  const s = summarizeTasks(tasks, month, null);

  it("counts completions by completion date, not by due date or current status", () => {
    expect(s.completedThisMonth).toBe(2);
    expect(s.recentlyCompleted.map((x) => x.gid)).toEqual(["done-this-month-due-this-month", "done-this-month-due-last-month"]);
  });

  it("counts due-this-month by due date whether done or not, and overdue as open past-due tasks", () => {
    expect(s.dueThisMonth).toBe(3);
    expect(s.overdue).toBe(2);
    expect(s.overdueTasks.every((x) => x.status === "overdue")).toBe(true);
  });

  it("lists upcoming deadlines within two weeks, soonest first", () => {
    expect(s.upcoming.map((x) => x.gid)).toEqual(["due-later-this-month"]);
  });
});

describe("demo data", () => {
  const period = resolvePeriod("last28", "previous", NOW);

  it("is only for the reserved .example domain", () => {
    expect(isDemoWebsite("https://lumencoast.example/")).toBe(true);
    for (const url of ["https://example.com", "https://spa.example.org", "https://headsonpillows.com", ""]) expect(isDemoWebsite(url)).toBe(false);
  });

  it("is never labelled live, and respects missing connections in mock mode", () => {
    const s = demoSummary({ id: 3, gscProperty: null, gaPropertyId: "1", asanaProjectGid: "" }, period, ALL_PARTS, { respectConnections: true, now: NOW });
    expect(s.demo).toBe(true);
    for (const part of ALL_PARTS) expect(s[part]?.state).not.toBe("live");
    expect(s.gsc?.state).toBe("not-connected");
    expect(s.tasks?.state).toBe("not-connected");
    expect(s.ga4?.state).toBe("demo");
  });

  it("is stable between loads", () => {
    const a = demoSummary({ id: 7 }, period, ["gsc"], { now: NOW });
    const b = demoSummary({ id: 7 }, period, ["gsc"], { now: NOW });
    expect(a.gsc?.data?.clicks).toEqual(b.gsc?.data?.clicks);
  });
});

describe("alerts", () => {
  const period = resolvePeriod("last28", "previous", NOW);
  const base = (over: Partial<ProjectSummary>): ProjectSummary => ({ projectId: 1, demo: false, period, generatedAt: 0, ...over });

  it("flags a real drop, but not a drop on a tiny base or missing data", () => {
    const pair = (current: number | null, previous: number | null) => ({ current, previous });
    const gsc = (c: number | null, p: number | null) => ({
      state: "live" as const,
      source: "GSC",
      data: { clicks: pair(c, p), impressions: pair(1, 1), ctr: pair(null, null), position: pair(null, null) },
    });
    expect(alertsFor(base({ gsc: gsc(500, 1000) })).map((a) => a.id)).toEqual(["gsc-clicks-drop"]);
    expect(alertsFor(base({ gsc: gsc(5, 10) }))).toEqual([]);
    expect(alertsFor(base({ gsc: gsc(null, 1000) }))).toEqual([]);
  });

  it("reports provider errors as errors, not as data", () => {
    const a = alertsFor(base({ ga4: { state: "error", source: "GA4", message: "quota" } }));
    expect(a).toEqual([expect.objectContaining({ id: "ga4-error", demo: false, detail: "quota" })]);
  });

  it("marks alerts from demo sections as demo", () => {
    const s = demoSummary({ id: 2 }, period, ALL_PARTS, { now: NOW });
    expect(alertsFor(s).every((a) => a.demo)).toBe(true);
  });

  it("treats a project without KPI targets as unknown, not as missing its KPI", () => {
    expect(meetsKpi(base({ kpi: { state: "unavailable", source: "KPI", message: "No targets" } }))).toBeNull();
    expect(needsAttention(base({}))).toBe(false);
  });
});

describe("summary cache", () => {
  it("expires entries after 15 minutes", () => {
    cacheClear();
    cacheSet("k", { a: 1 }, 0);
    expect(cacheGet("k", 14 * 60_000)).toEqual({ a: 1 });
    expect(cacheGet("k", 16 * 60_000)).toBeNull();
  });
});
