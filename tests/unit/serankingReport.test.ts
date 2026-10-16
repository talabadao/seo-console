// Rank tracking → SE Ranking: the report view's definitions (cumulative Top 3/5/10, SE Ranking's average with
// unranked = 100 and unchecked keywords left out, one engine at a time, keyword groups, comparison check,
// per-day history, keyword changes) and that the dashboard card is derived from the same view.
import { describe, expect, it } from "vitest";
import { viewReport, type SeRawReport } from "@/lib/seranking/report";
import { rankingsFromView } from "@/lib/seranking/rankings";
import { demoRankings, demoSeRawReport } from "@/lib/v2/summary/demo";

const kw = (id: string, groupId: string | null, positions: Array<[string, number]>) => ({
  id,
  name: `keyword ${id}`,
  groupId,
  volume: 100,
  landing: null,
  features: [],
  ownFeatures: [],
  positions: positions.map(([date, pos]) => ({ date, pos })),
});

const raw: SeRawReport = {
  site: { id: 7, title: "Site", url: "https://site.example/" },
  from: "2026-09-01",
  to: "2026-10-15",
  engines: [
    { id: 11, name: "Google Vietnam", region: null, language: "vi", device: null, keywordCount: 5 },
    { id: 12, name: "Google USA", region: null, language: "en", device: null, keywordCount: 1 },
  ],
  groups: [
    { id: "g1", name: "Brand" },
    { id: "g2", name: "Rooms" },
  ],
  keywords: {
    "11": [
      kw("a", "g1", [["2026-10-07", 4], ["2026-10-14", 2]]),
      kw("b", "g1", [["2026-10-07", 12], ["2026-10-14", 5]]),
      kw("c", "g2", [["2026-10-07", 9], ["2026-10-14", 0]]), // dropped out of the top 100
      kw("d", "g2", [["2026-10-07", 0], ["2026-10-14", 30]]), // new
      kw("e", "g2", [["2026-10-07", 50]]), // no check on the latest date
    ],
    "12": [kw("x", null, [["2026-10-14", 1]])],
  },
};

describe("SE Ranking report view", () => {
  it("uses the engine with most keywords by default and never mixes engines", () => {
    const v = viewReport(raw, { compareDays: 7 });
    expect(v.engine.id).toBe(11);
    expect(v.keywords).toHaveLength(5);
    expect(viewReport(raw, { engineId: 12, compareDays: 7 }).keywords.map((k) => k.id)).toEqual(["x"]);
  });

  it("counts cumulative tops and SE Ranking's average (unranked = 100, unchecked left out)", () => {
    const v = viewReport(raw, { compareDays: 7 });
    expect(v.latestDate).toBe("2026-10-14");
    expect(v.comparisonDate).toBe("2026-10-07");
    // Latest: a=2, b=5, c=0 (→100), d=30; e last checked 10-07 at 50 (latest on or before).
    expect(v.current).toMatchObject({ top3: 1, top5: 2, top10: 2, ranked: 4, checked: 5 });
    expect(v.current.avgPosition).toBe(Math.round(((2 + 5 + 100 + 30 + 50) / 5) * 10) / 10);
    expect(v.current.rankedAvgPosition).toBe(Math.round(((2 + 5 + 30 + 50) / 4) * 10) / 10);
    expect(v.previous).toMatchObject({ top3: 0, top5: 1, top10: 2, ranked: 4 });
  });

  it("history counts only the keywords checked that day", () => {
    const v = viewReport(raw, { compareDays: 7 });
    expect(v.history.map((h) => [h.date, h.checked])).toEqual([
      ["2026-10-07", 5],
      ["2026-10-14", 4],
    ]);
    expect(v.history[1].avgPosition).toBe(Math.round(((2 + 5 + 100 + 30) / 4) * 10) / 10);
  });

  it("filters by keyword group, with names and counts", () => {
    const v = viewReport(raw, { group: "g1", compareDays: 7 });
    expect(v.keywords.map((k) => k.id)).toEqual(["a", "b"]);
    expect(v.groups).toEqual([
      { id: "g1", name: "Brand", keywords: 2 },
      { id: "g2", name: "Rooms", keywords: 3 },
    ]);
    expect(viewReport(raw, { group: "nope", compareDays: 7 }).group).toBeNull();
  });

  it("keyword changes: gained positions, new, lost, not checked", () => {
    const byId = Object.fromEntries(viewReport(raw, { compareDays: 7 }).keywords.map((k) => [k.id, k]));
    expect(byId.b).toMatchObject({ current: 5, previous: 12, change: 7, best: 5 });
    expect(byId.c).toMatchObject({ current: null, previous: 9, change: null });
    expect(byId.d).toMatchObject({ current: 30, previous: null, change: null });
    expect(byId.a.trend).toEqual([4, 2]);
  });

  it("with no earlier check there is no comparison", () => {
    const v = viewReport(raw, { compareDays: 28 });
    expect(v.comparisonDate).toBeNull();
    expect(v.previous).toBeNull();
  });

  it("the dashboard card shows the same numbers as the page", () => {
    const v = viewReport(raw, { compareDays: 7 });
    const card = rankingsFromView(v);
    expect(card.current).toEqual(v.current);
    expect(card.previous).toEqual(v.previous);
    expect(card.context).toMatchObject({ engine: "Google Vietnam", trackedKeywords: 5, otherEngines: 1, latestDate: "2026-10-14", comparisonDate: "2026-10-07" });
    // Demo projects too.
    const now = new Date("2026-10-16T08:00:00Z");
    const period = { current: { start: "2026-09-18", end: "2026-10-15" }, previous: { start: "2026-08-21", end: "2026-09-17" } } as never;
    const demoCard = demoRankings(3, period, now);
    const demoPage = viewReport(demoSeRawReport(3, 28, now), { compareDays: 28 });
    expect(demoCard.state).toBe("demo");
    expect(demoCard.data!.current).toEqual(demoPage.current);
  });
});
