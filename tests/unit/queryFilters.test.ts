import { describe, expect, it } from "vitest";
import type { BreakdownRow } from "@/lib/gscLive";
import {
  DEFAULT_FILTER_CONFIG,
  EMPTY_FILTER,
  applyFilters,
  classifyAiPrompt,
  isBotQuery,
  isOfftopicFiller,
} from "@/lib/queryFilters";

function row(key: string, over: Partial<BreakdownRow> = {}): BreakdownRow {
  return {
    key,
    clicks: 10,
    impressions: 100,
    ctr: 0.1,
    position: 5,
    prevClicks: 10,
    prevImpressions: 100,
    prevCtr: 0.1,
    prevPosition: 5,
    isNew: false,
    ...over,
  };
}

describe("AI prompt labels", () => {
  it("flags system-prompt and search-agent text as bot", () => {
    expect(isBotQuery("# Role: travel planner")).toBe(true);
    expect(isBotQuery("My main motivations: relax. My main pain points: price. best hotel")).toBe(true);
    expect(isBotQuery("hotel phu quoc -site:booking.com -site:agoda.com")).toBe(true);
    expect(isBotQuery("best hotel in phu quoc")).toBe(false);
  });

  it("flags filler, but never short CJK words", () => {
    expect(isOfftopicFiller("ok")).toBe(true);
    expect(isOfftopicFiller("Option B")).toBe(true);
    expect(isOfftopicFiller("价格")).toBe(false);
    expect(isOfftopicFiller("越南")).toBe(false);
    expect(isOfftopicFiller("spa")).toBe(false);
  });

  it("checks bot before offtopic before new", () => {
    expect(classifyAiPrompt(row("# role", { isNew: true }))).toBe("bot");
    expect(classifyAiPrompt(row("ok", { isNew: true }))).toBe("offtopic");
    expect(classifyAiPrompt(row("hotel deals", { isNew: true }))).toBe("new");
    expect(classifyAiPrompt(row("hotel deals"))).toBeNull();
  });
});

describe("applyFilters", () => {
  const cfg = { ...DEFAULT_FILTER_CONFIG, brandTerms: ["kin hotel"] };
  const rows = [
    row("kin hotel saigon", { clicks: 20, prevClicks: 5 }),
    row("cheap hotel", { clicks: 2, prevClicks: 9, position: 12 }),
    row("new query", { prevClicks: 0, isNew: true }),
  ];
  const keys = (r: BreakdownRow[]) => r.map((x) => x.key);

  it("returns everything with no filters", () => {
    expect(keys(applyFilters(rows, EMPTY_FILTER, cfg, "query"))).toEqual(keys(rows));
  });

  it("Winning / Losing / New compare against the previous period", () => {
    expect(keys(applyFilters(rows, { ...EMPTY_FILTER, trend: "growing" }, cfg, "query"))).toEqual([
      "kin hotel saigon",
      "new query",
    ]);
    expect(keys(applyFilters(rows, { ...EMPTY_FILTER, trend: "decaying" }, cfg, "query"))).toEqual(["cheap hotel"]);
    expect(keys(applyFilters(rows, { ...EMPTY_FILTER, trend: "new" }, cfg, "query"))).toEqual(["new query"]);
  });

  it("applies position and branded filters", () => {
    expect(keys(applyFilters(rows, { ...EMPTY_FILTER, position: 10 }, cfg, "query"))).not.toContain("cheap hotel");
    expect(keys(applyFilters(rows, { ...EMPTY_FILTER, branded: "branded" }, cfg, "query"))).toEqual([
      "kin hotel saigon",
    ]);
  });

  it("ignores query-only text filters on other dimensions", () => {
    expect(applyFilters(rows, { ...EMPTY_FILTER, branded: "branded" }, cfg, "page")).toHaveLength(3);
  });
});
