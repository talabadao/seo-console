import { describe, expect, it } from "vitest";
import { DEFAULT_AI_DOMAINS, classifyTraffic } from "@/lib/ga4";
import { Weighted, domainsOfPlatform, platformOf, sourceFilter } from "@/lib/v2/llm/platforms";
import { demoLlmReport } from "@/lib/v2/llm/demo";
import { resolvePeriod } from "@/lib/v2/summary/period";

describe("LLMs Traffic platforms", () => {
  it("groups sources into platforms with the same rule as the dashboard's AI sessions", () => {
    expect(platformOf("chatgpt.com", DEFAULT_AI_DOMAINS)?.name).toBe("ChatGPT");
    expect(platformOf("chat.openai.com", DEFAULT_AI_DOMAINS)?.name).toBe("ChatGPT");
    expect(platformOf("gemini.google.com", DEFAULT_AI_DOMAINS)?.name).toBe("Gemini");
    expect(platformOf("google", DEFAULT_AI_DOMAINS)).toBeNull();
    for (const source of ["chatgpt.com", "perplexity.ai", "claude.ai", "google", "facebook.com", "you.com"]) {
      expect(platformOf(source, DEFAULT_AI_DOMAINS) !== null).toBe(classifyTraffic(source, "", DEFAULT_AI_DOMAINS) === "ai");
    }
  });

  it("names sources it doesn't know by their domain, and respects a custom list", () => {
    expect(platformOf("you.com", DEFAULT_AI_DOMAINS)?.name).toBe("you.com");
    expect(platformOf("chatgpt.com", ["perplexity.ai"])).toBeNull();
  });

  it("filters a platform to its own list entries, case-insensitively", () => {
    expect(domainsOfPlatform("chatgpt", DEFAULT_AI_DOMAINS).sort()).toEqual(["chat.openai.com", "chatgpt.com", "openai.com"]);
    const f = sourceFilter(["chatgpt.com", "claude.ai"]) as { orGroup: { expressions: { filter: { stringFilter: { matchType: string; caseSensitive: boolean } } }[] } };
    expect(f.orGroup.expressions).toHaveLength(2);
    expect(f.orGroup.expressions[0].filter.stringFilter).toMatchObject({ matchType: "CONTAINS", caseSensitive: false });
  });

  it("weights averages by sessions when combining sources", () => {
    const w = new Weighted();
    w.add(90, { dur: 100 });
    w.add(10, { dur: 1000 });
    expect(w.avg("dur")).toBe(190);
    expect(new Weighted().avg("dur")).toBeNull();
  });
});

describe("LLMs Traffic report shape", () => {
  const period = resolvePeriod("last28", "previous", new Date("2026-10-15T00:00:00Z"));

  it("shows a share chart for sessions only", () => {
    expect(demoLlmReport(1, period, "sessions", "day", "all").share).not.toBeNull();
    expect(demoLlmReport(1, period, "users", "day", "all").share).toBeNull();
  });

  it("never reports a user total as the sum of platform users", () => {
    const r = demoLlmReport(1, period, "users", "day", "all");
    const sum = r.platforms.reduce((a, p) => a + (p.value.current ?? 0), 0);
    expect(r.total.current).not.toBe(sum);
  });

  it("keeps engagement time within session duration and the filter on the trend", () => {
    const r = demoLlmReport(2, period, "sessions", "week", "gemini");
    for (const e of r.engagement) expect(e.avgEngagementTimePerSession!).toBeLessThanOrEqual(e.avgSessionDuration!);
    expect(r.trend.series.map((s) => s.id)).toEqual(["gemini"]);
    expect(r.platforms.length).toBeGreaterThan(1);
  });
});
