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
    const labels = NAV.flatMap((g) => [g.label, ...g.items.map((i) => i.label)]);
    for (const l of [
      "Dashboard",
      "Keyword Research",
      "Competitive Research",
      "Link Building",
      "SE Ranking",
      "Google Search Tracking",
      "Bing Search Tracking",
      "Yandex Search Tracking",
      "Naver Search Tracking",
      "Google Search Console",
      "Google Analytics 4",
      "Google Business Profile",
      "Google Maps Reviews",
      "Site Audit",
      "PageSpeed Insights",
      "Indexing",
      "Structured Data / Schema",
      "Content",
      "AI Area",
      "Automation",
      "Weekly Report",
      "Monthly Report",
      "Settings",
    ]) {
      expect(labels).toContain(l);
    }
    expect(findItem("technical-seo", "structured-data")?.item.status).toBe("planned");
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
