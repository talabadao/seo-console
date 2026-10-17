import { describe, expect, it } from "vitest";
import { parsePsi } from "@/lib/pagespeedParse";

const sample = {
  lighthouseResult: {
    categories: { performance: { score: 0.63 } },
    audits: {
      "first-contentful-paint": { id: "first-contentful-paint", title: "FCP", numericValue: 2400 },
      "largest-contentful-paint": { id: "largest-contentful-paint", title: "LCP", numericValue: 4100.5 },
      "total-blocking-time": { id: "total-blocking-time", title: "TBT", numericValue: 320 },
      "cumulative-layout-shift": { id: "cumulative-layout-shift", title: "CLS", numericValue: 0.08 },
      "speed-index": { id: "speed-index", title: "SI", numericValue: 5000 },
      "unused-javascript": {
        id: "unused-javascript",
        title: "Reduce unused JavaScript",
        description: "Reduce unused JS. [Learn how](https://developer.chrome.com/x).",
        score: 0.4,
        scoreDisplayMode: "metricSavings",
        details: { type: "opportunity", overallSavingsMs: 900, overallSavingsBytes: 317000 },
        metricSavings: { LCP: 450 },
      },
      "render-blocking-insight": {
        id: "render-blocking-insight",
        title: "Render blocking requests",
        score: 0,
        scoreDisplayMode: "metricSavings",
        metricSavings: { LCP: 1200, FCP: 1200 },
      },
      "uses-http2": {
        id: "uses-http2",
        title: "Use HTTP/2",
        score: 1,
        scoreDisplayMode: "metricSavings",
        metricSavings: { LCP: 0 },
      },
      "manual-check": { id: "manual-check", title: "Manual", score: null, scoreDisplayMode: "manual" },
    },
  },
  loadingExperience: {
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2890 },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12 },
    },
    overall_category: "AVERAGE",
    origin_fallback: true,
  },
};

describe("parsePsi", () => {
  const r = parsePsi(sample);

  it("keeps lab (Lighthouse) and field (CrUX) numbers separate", () => {
    expect(r.score).toBe(63);
    expect(r.lcp).toBe(4100.5);
    expect(r.fieldLcp).toBe(2890);
  });

  it("converts CrUX CLS from x100 and flags origin-level field data", () => {
    expect(r.fieldCls).toBe(0.12);
    expect(r.fieldOrigin).toBe(true);
  });

  it("reports missing field metrics as null, never 0", () => {
    expect(r.fieldInp).toBeNull();
    expect(r.fieldTtfb).toBeNull();
  });

  it("orders recommendations by estimated saving and skips passed or manual audits", () => {
    expect(r.recommendations.map((x) => x.id)).toEqual(["render-blocking-insight", "unused-javascript"]);
    expect(r.recommendations[1]).toMatchObject({
      savingsMs: 900,
      savingsBytes: 317000,
      learnMore: "https://developer.chrome.com/x",
      description: "Reduce unused JS. Learn how.",
    });
  });

  it("returns an all-null result for an empty response instead of zeros", () => {
    const empty = parsePsi({});
    expect(empty.score).toBeNull();
    expect(empty.lcp).toBeNull();
    expect(empty.fieldCategory).toBeNull();
    expect(empty.recommendations).toEqual([]);
  });
});
