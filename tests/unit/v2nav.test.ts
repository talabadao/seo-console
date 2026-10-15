import { describe, expect, it } from "vitest";
import {
  NAV,
  buildShellPath,
  findItem,
  isShellPath,
  meetsRequirement,
  parseShellPath,
  switchProject,
  type ShellLocation,
} from "@/lib/v2/nav";

describe("navigation model", () => {
  it("has unique group ids and unique item ids within each group", () => {
    const groups = NAV.map((g) => g.id);
    expect(new Set(groups).size).toBe(groups.length);
    for (const g of NAV) {
      const items = g.items.map((i) => i.id);
      expect(new Set(items).size).toBe(items.length);
    }
  });

  it("covers every destination in the product spec, including Structured Data / Schema", () => {
    // Spec destination -> where it lives. Labels are short in the sidebar; the group gives context.
    const spec: [string, string, string][] = [
      ["Dashboard", "dashboard", "overview"],
      ["Keyword Research", "keyword-research", "explorer"],
      ["Competitive Research", "competitive-research", "overview"],
      ["Link Building", "link-building", "backlinks"],
      ["SE Ranking", "organic-serp", "se-ranking"],
      ["Google Search Tracking", "organic-serp", "google"],
      ["Bing Search Tracking", "organic-serp", "bing"],
      ["Yandex Search Tracking", "organic-serp", "yandex"],
      ["Naver Search Tracking", "organic-serp", "naver"],
      ["Google Search Console", "search-console", "performance"],
      ["Google Analytics 4", "analytics", "overview"],
      ["Google Business Profile", "local-seo", "business-profile"],
      ["Google Maps Reviews", "local-seo", "reviews"],
      ["Site Audit", "technical-seo", "site-audit"],
      ["PageSpeed Insights", "technical-seo", "pagespeed"],
      ["Indexing", "technical-seo", "indexing"],
      ["Structured Data / Schema", "technical-seo", "structured-data"],
      ["Content", "content", "board"],
      ["AI Area", "ai-area", "overview"],
      ["Automation", "automation", "workflows"],
      ["Weekly Report", "reports", "weekly"],
      ["Monthly Report", "reports", "monthly"],
      ["Settings", "settings", "project"],
    ];
    for (const [name, group, item] of spec) expect(findItem(group, item), name).not.toBeNull();
    expect(findItem("technical-seo", "structured-data")?.item.label).toBe("Structured Data / Schema");
    expect(findItem("technical-seo", "structured-data")?.item.status).toBe("planned");
  });

  it("keeps sidebar labels short enough to read without truncation", () => {
    for (const g of NAV) {
      expect(g.label.length, g.label).toBeLessThanOrEqual(18);
      for (const i of g.items) expect(i.label.length, i.label).toBeLessThanOrEqual(24);
    }
  });

  it("marks demo and planned items with the milestone that makes them real", () => {
    for (const g of NAV) for (const i of g.items) if (i.status !== "live") expect(i.milestone).toBeTruthy();
  });
});

describe("shell addresses", () => {
  it("round-trips every kind of location", () => {
    const locs: ShellLocation[] = [
      { kind: "portfolio" },
      { kind: "docs" },
      { kind: "pick", group: "search-console", item: "performance" },
      { kind: "project", projectId: 12, group: "analytics", item: "overview", sub: "key-events" },
      { kind: "project", projectId: 3, group: "technical-seo", item: "structured-data", sub: "" },
    ];
    for (const l of locs) expect(parseShellPath(buildShellPath(l).split("/").filter(Boolean))).toEqual(l);
  });

  it("uses the project id, not its name, and falls back safely", () => {
    expect(parseShellPath(["p", "kin-hotel", "search-console", "performance"])).toEqual({ kind: "portfolio" });
    expect(parseShellPath(["p", "-4"])).toEqual({ kind: "portfolio" });
    expect(parseShellPath(["p", "7", "nope", "nope"])).toEqual({
      kind: "project",
      projectId: 7,
      group: "dashboard",
      item: "overview",
      sub: "",
    });
    expect(parseShellPath(["portfolio", "nope", "x"])).toEqual({ kind: "portfolio" });
  });

  it("leaves legacy addresses to the classic dashboard", () => {
    expect(isShellPath(["kin-hotel", "performance"])).toBe(false);
    expect(isShellPath([])).toBe(false);
    expect(parseShellPath(["kin-hotel", "performance"])).toBeNull();
    expect(isShellPath(["p", "1"])).toBe(true);
    expect(isShellPath(["portfolio"])).toBe(true);
  });
});

describe("project switching", () => {
  it("keeps the page but drops the sub-tab, and All projects goes to the portfolio", () => {
    const here: ShellLocation = { kind: "project", projectId: 1, group: "analytics", item: "overview", sub: "geo" };
    expect(switchProject(here, 2)).toEqual({ kind: "project", projectId: 2, group: "analytics", item: "overview", sub: "" });
    expect(switchProject(here, null)).toEqual({ kind: "portfolio" });
    expect(switchProject({ kind: "pick", group: "technical-seo", item: "pagespeed" }, 5)).toEqual({
      kind: "project",
      projectId: 5,
      group: "technical-seo",
      item: "pagespeed",
      sub: "",
    });
    expect(switchProject({ kind: "portfolio" }, 5)).toMatchObject({ projectId: 5, group: "dashboard", item: "overview" });
    expect(switchProject({ kind: "project", projectId: 1, group: "settings", item: "project", sub: "kpi" }, 2)).toEqual({
      kind: "project",
      projectId: 2,
      group: "settings",
      item: "project",
      sub: "kpi",
    });
  });

  it("checks what a live page needs from the project", () => {
    const p = { gscProperty: "sc-domain:example.com", gaPropertyId: null, mapsUrl: "", hasSerpKey: true };
    expect(meetsRequirement("gsc", p)).toBe(true);
    expect(meetsRequirement("ga4", p)).toBe(false);
    expect(meetsRequirement("reviews", p)).toBe(false);
    expect(meetsRequirement(undefined, p)).toBe(true);
  });
});

describe("feature flag and local mock mode", () => {
  it("keeps the v2 shell off unless V2_SHELL=1", async () => {
    const { v2ShellEnabled } = await import("@/lib/v2/flag");
    expect(v2ShellEnabled({})).toBe(false);
    expect(v2ShellEnabled({ V2_SHELL: "true" })).toBe(false);
    expect(v2ShellEnabled({ V2_SHELL: "1" })).toBe(true);
  });

  it("never enables mock mode on a deployment", async () => {
    const { devMockEnabled } = await import("@/lib/v2/devMock");
    expect(devMockEnabled({ V2_MOCK: "1", NODE_ENV: "development" })).toBe(true);
    expect(devMockEnabled({ V2_MOCK: "1", NODE_ENV: "development", VERCEL_ENV: "preview" })).toBe(false);
    expect(devMockEnabled({ V2_MOCK: "1", NODE_ENV: "production" })).toBe(false);
    expect(devMockEnabled({ NODE_ENV: "development" })).toBe(false);
  });
});
