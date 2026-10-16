import { describe, expect, it } from "vitest";
import { evaluateKpi, ATTAINMENT_LABEL } from "@/lib/v2/summary/kpi";
import { insightLists, readableUrl } from "@/lib/v2/summary/insights";
import { matchSite, positionOnOrBefore, rankCounts, rankOf } from "@/lib/seranking/rankings";
import { alertsFor, meetsKpi } from "@/lib/v2/summary/alerts";
import { resolvePeriod } from "@/lib/v2/summary/period";
import { classifyTraffic, DEFAULT_AI_DOMAINS } from "@/lib/ga4";
import type { ProjectSummary } from "@/lib/v2/summary/types";

describe("KPI attainment wording", () => {
  const base = { id: "k", label: "Organic sessions", target: 1000 };

  it("never calls a running month's KPI 'below target' just because the full-month target isn't reached yet", () => {
    const k = evaluateKpi({ ...base, actual: 400, projected: 900, monthComplete: false });
    expect(k.attainment).toBe("in-progress");
    expect(k.attainmentPct).toBe(40);
    expect(k.projection).toBe("below");
  });

  it("is final once the month has ended", () => {
    expect(evaluateKpi({ ...base, actual: 950, projected: 950, monthComplete: true }).attainment).toBe("below");
    expect(evaluateKpi({ ...base, actual: 1200, projected: 1200, monthComplete: true }).attainment).toBe("achieved");
  });

  it("respects metrics where lower is better", () => {
    const over = evaluateKpi({ ...base, direction: "lower", actual: 1100, projected: 1300, monthComplete: false });
    expect(over.attainment).toBe("above");
    expect(over.projection).toBe("above");
    expect(evaluateKpi({ ...base, direction: "lower", actual: 300, projected: 800, monthComplete: false }).projection).toBe("achieved");
  });

  it("reports a missing target as no target, and uses no delivery-status words", () => {
    expect(evaluateKpi({ ...base, target: null, actual: 50, projected: 100, monthComplete: false }).attainment).toBe("no-target");
    // An explicit zero target is a real target (KPI Planning keeps blank and 0 apart).
    expect(evaluateKpi({ ...base, target: 0, actual: 50, projected: 100, monthComplete: false }).attainment).toBe("achieved");
    expect(Object.values(ATTAINMENT_LABEL).join(" ")).not.toMatch(/off track|on track|at risk/i);
  });

  it("alerts on projection, not on an unfinished month", () => {
    const period = resolvePeriod("last28", "previous", new Date("2026-10-15T00:00:00Z"));
    const s: ProjectSummary = {
      projectId: 1,
      demo: false,
      period,
      generatedAt: 0,
      kpi: {
        state: "live",
        source: "KPI",
        data: {
          yearMonth: "2026-10",
          monthLabel: "October 2026",
          daysElapsed: 14,
          daysInMonth: 31,
          monthComplete: false,
          leadEvents: [],
          notes: [],
          items: [
            evaluateKpi({ ...base, id: "a", actual: 450, projected: 1050, monthComplete: false }),
            evaluateKpi({ ...base, id: "b", actual: 300, projected: 700, monthComplete: false }),
          ],
        },
      },
    };
    const alerts = alertsFor(s);
    expect(alerts.map((a) => a.id)).toEqual(["kpi-b"]);
    expect(alerts[0].title).toMatch(/projected below/i);
    expect(alerts[0].title).not.toMatch(/off track/i);
    expect(meetsKpi(s)).toBe(false);
  });
});

describe("Search Console insight lists", () => {
  const cur = [
    { key: "a", clicks: 100 },
    { key: "b", clicks: 80 },
    { key: "c", clicks: 30 },
    { key: "new", clicks: 20 },
  ];
  const prev = [
    { key: "a", clicks: 150 },
    { key: "b", clicks: 40 },
    { key: "c", clicks: 30 },
    { key: "gone", clicks: 25 },
  ];

  it("ranks top by clicks and trends by the change in clicks", () => {
    const l = insightLists(cur, prev, true);
    expect(l.top.map((r) => r.key)).toEqual(["a", "b", "c", "new"]);
    expect(l.up.map((r) => r.key)).toEqual(["b", "new"]);
    expect(l.down.map((r) => r.key)).toEqual(["a", "gone"]);
    expect(l.top.find((r) => r.key === "new")?.previousClicks).toBe(0);
  });

  it("treats a row missing from a cut-off comparison as unknown, and keeps it out of the trends", () => {
    const l = insightLists(cur, prev, false);
    expect(l.top.find((r) => r.key === "new")?.previousClicks).toBeNull();
    expect(l.up.map((r) => r.key)).toEqual(["b"]);
  });

  it("shows URLs readably", () => {
    expect(readableUrl("https://www.example.com/")).toEqual({ host: "example.com", path: "/ (home)" });
    expect(readableUrl("https://example.com/drink-dine/?utm_source=google#x").path).toBe("/drink-dine/?utm_source=google#x");
  });
});

describe("SE Ranking thresholds", () => {
  it("counts Top 3 / 5 / 10 cumulatively", () => {
    const c = rankCounts([1, 2, 4, 5, 7, 10, 11, 50]);
    expect(c).toMatchObject({ top3: 2, top5: 4, top10: 6, ranked: 8 });
  });

  it("never treats a missing or unranked keyword as position 0", () => {
    expect(rankOf(0)).toBeNull();
    expect(rankOf(undefined)).toBeNull();
    expect(rankOf(101)).toBeNull();
    const c = rankCounts([0, 0, null, undefined, 4, 6]);
    expect(c.ranked).toBe(2);
    expect(c.checked).toBe(4);
    // SE Ranking's average: the two unranked keywords count as 100; the two without a check are left out.
    expect(c.avgPosition).toBe(52.5);
    expect(c.rankedAvgPosition).toBe(5);
    expect(rankCounts([null, undefined]).avgPosition).toBeNull();
    expect(rankCounts([0]).rankedAvgPosition).toBeNull();
  });

  it("uses the latest check on or before the comparison date", () => {
    const checks = [
      { date: "2026-09-10", pos: 8 },
      { date: "2026-09-15", pos: 5 },
      { date: "2026-10-14", pos: 3 },
    ];
    expect(positionOnOrBefore(checks, "2026-09-16")).toBe(5);
    expect(positionOnOrBefore(checks, "2026-09-01")).toBeUndefined();
  });

  it("matches a project to the SE Ranking site tracking its website", () => {
    const sites = [
      { id: 1, title: "Other", url: "https://other.com/", keywordCount: 5 },
      { id: 2, title: "Hotel", url: "https://www.hotel.com/", keywordCount: 40 },
      { id: 3, title: "Hotel blog", url: "https://blog.hotel.com/", keywordCount: 10 },
    ];
    expect(matchSite(sites, "https://hotel.com")?.id).toBe(2);
    expect(matchSite(sites, "https://nothing.example")).toBeNull();
  });
});

describe("AI sessions classification", () => {
  it("uses the same AI source list for the dashboard and LLMs Traffic", () => {
    expect(classifyTraffic("chatgpt.com", "Referral", DEFAULT_AI_DOMAINS)).toBe("ai");
    expect(classifyTraffic("perplexity.ai", "Referral", DEFAULT_AI_DOMAINS)).toBe("ai");
    expect(classifyTraffic("google", "Organic Search", DEFAULT_AI_DOMAINS)).toBe("organic");
    expect(classifyTraffic("facebook.com", "Organic Social", DEFAULT_AI_DOMAINS)).toBe("other");
  });
});
