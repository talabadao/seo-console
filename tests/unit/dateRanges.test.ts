import { describe, expect, it } from "vitest";
import { resolveComparison, resolveRange, spanDays } from "@/lib/dateRanges";

// Fixed "now" so results don't depend on the day the tests run.
const anchor = new Date(2026, 9, 15, 12); // 15 Oct 2026, local time

describe("resolveRange", () => {
  it("ends yesterday, because Search Console lags", () => {
    expect(resolveRange("28d", { anchor })).toEqual({ start: "2026-09-17", end: "2026-10-14" });
    expect(spanDays(resolveRange("7d", { anchor }))).toBe(7);
  });

  it("resolves calendar presets", () => {
    expect(resolveRange("lastMonth", { anchor })).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(resolveRange("thisMonth", { anchor })).toEqual({ start: "2026-10-01", end: "2026-10-14" });
    expect(resolveRange("lastWeek", { anchor })).toEqual({ start: "2026-10-05", end: "2026-10-11" });
  });

  it("keeps custom dates as given", () => {
    expect(resolveRange("custom", { anchor, customStart: "2026-01-01", customEnd: "2026-01-31" })).toEqual({
      start: "2026-01-01",
      end: "2026-01-31",
    });
  });
});

describe("resolveComparison", () => {
  const cur = { start: "2026-09-17", end: "2026-10-14" };

  it("previous period has the same length, right before", () => {
    expect(resolveComparison(cur, "previous")).toEqual({ start: "2026-08-20", end: "2026-09-16" });
  });

  it("match weekdays shifts by whole weeks", () => {
    const r = resolveComparison({ start: "2026-10-01", end: "2026-10-10" }, "previous", { matchWeekdays: true })!;
    expect(spanDays(r)).toBe(10);
    expect(new Date(r.start).getUTCDay()).toBe(new Date("2026-10-01").getUTCDay());
  });

  it("year over year, and none", () => {
    expect(resolveComparison(cur, "yoy")).toEqual({ start: "2025-09-17", end: "2025-10-14" });
    expect(resolveComparison(cur, "none")).toBeNull();
  });
});
