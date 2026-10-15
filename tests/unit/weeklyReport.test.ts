import { describe, expect, it } from "vitest";
import { buildKpiCard, reportWindows } from "@/lib/weeklyReport";

const w = reportWindows(new Date(2026, 9, 16, 12)); // data through 15 Oct 2026

describe("reportWindows", () => {
  it("anchors month-to-date on yesterday", () => {
    expect(w.yearMonth).toBe("2026-10");
    expect(w.mtd).toEqual({ start: "2026-10-01", end: "2026-10-15" });
    expect(w.daysInMonth).toBe(31);
    expect(w.daysElapsed).toBe(15);
  });
});

describe("buildKpiCard pacing", () => {
  it("projects the month from the last 30 days and grades the pace", () => {
    expect(buildKpiCard(500, 3000, 3100, w).pace).toBe("on-track"); // projects 3,100 = 100%
    expect(buildKpiCard(500, 2700, 3100, w).pace).toBe("at-risk"); // 2,790 = 90%
    expect(buildKpiCard(500, 2000, 3100, w).pace).toBe("off-track"); // 2,067 = 67%
  });

  it("treats a missing target as no target, not as a miss", () => {
    const none = buildKpiCard(0, 0, 0, w);
    expect(none.projectedPct).toBe(0);
    expect(none.paceDeltaPct).toBe(0);
  });
});
