// Date periods for the v2 dashboards, computed in UTC so the server and
// every browser agree on the same dates. The performance period ends
// yesterday (Search Console and GA4 both lag about a day); the monthly
// task/KPI period is the calendar month, stated separately on screen.

import type { PeriodInfo } from "./types";

export const RANGE_PRESETS = [
  { id: "last7", label: "Last 7 days" },
  { id: "last28", label: "Last 28 days" },
  { id: "last90", label: "Last 90 days" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number]["id"];

export const COMPARE_MODES = [
  { id: "previous", label: "Previous period" },
  { id: "yoy", label: "Same period last year" },
  { id: "none", label: "No comparison" },
] as const;
export type CompareMode = (typeof COMPARE_MODES)[number]["id"];

export const DEFAULT_PRESET: RangePreset = "last28";
export const DEFAULT_COMPARE: CompareMode = "previous";

const DAY = 86_400_000;

export function ymdUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function parse(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}
function addDays(ymd: string, n: number): string {
  return ymdUTC(new Date(parse(ymd).getTime() + n * DAY));
}
function monthStart(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}
function monthEnd(ymd: string): string {
  const d = parse(monthStart(ymd));
  return ymdUTC(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}
function minusYear(ymd: string): string {
  const d = parse(ymd);
  // 29 Feb maps to 28 Feb.
  const t = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()));
  if (t.getUTCMonth() !== d.getUTCMonth()) t.setUTCDate(0);
  return ymdUTC(t);
}
export function daysBetween(start: string, end: string): number {
  return Math.round((parse(end).getTime() - parse(start).getTime()) / DAY) + 1;
}

export function isPreset(v: string | null | undefined): v is RangePreset {
  return RANGE_PRESETS.some((p) => p.id === v);
}
export function isCompare(v: string | null | undefined): v is CompareMode {
  return COMPARE_MODES.some((c) => c.id === v);
}

const fmt = (ymd: string) =>
  parse(ymd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const rangeLabel = (r: { start: string; end: string }) => `${fmt(r.start)} – ${fmt(r.end)}`;

/** Resolves a preset and comparison into concrete dates, anchored on `now`. */
export function resolvePeriod(preset: RangePreset, compare: CompareMode, now: Date = new Date()): PeriodInfo {
  const end = addDays(ymdUTC(now), -1);
  let current: { start: string; end: string };
  switch (preset) {
    case "last7":
      current = { start: addDays(end, -6), end };
      break;
    case "last28":
      current = { start: addDays(end, -27), end };
      break;
    case "last90":
      current = { start: addDays(end, -89), end };
      break;
    case "thisMonth":
      current = { start: monthStart(end), end };
      break;
    case "lastMonth": {
      const prevEnd = addDays(monthStart(end), -1);
      current = { start: monthStart(prevEnd), end: prevEnd };
      break;
    }
  }
  let previous: { start: string; end: string } | null = null;
  if (compare === "yoy") {
    previous = { start: minusYear(current.start), end: minusYear(current.end) };
  } else if (compare === "previous") {
    if (preset === "lastMonth" || preset === "thisMonth") {
      // The month before, over the same number of days (the whole month for "last month").
      const prevMonthEnd = addDays(current.start, -1);
      const start = monthStart(prevMonthEnd);
      const len = daysBetween(current.start, current.end);
      const end2 = preset === "lastMonth" ? prevMonthEnd : addDays(start, Math.min(len, daysBetween(start, prevMonthEnd)) - 1);
      previous = { start, end: end2 };
    } else {
      const len = daysBetween(current.start, current.end);
      previous = { start: addDays(current.start, -len), end: addDays(current.start, -1) };
    }
  }
  const presetLabel = RANGE_PRESETS.find((p) => p.id === preset)!.label;
  const compareLabel = COMPARE_MODES.find((c) => c.id === compare)!.label;
  return {
    preset,
    compare,
    label: `${presetLabel} (${rangeLabel(current)})`,
    compareLabel: previous ? `${compareLabel} (${rangeLabel(previous)})` : null,
    current,
    previous,
  };
}

/** The calendar month containing `now`, in UTC — the period for task counts. */
export function taskMonth(now: Date = new Date()) {
  const today = ymdUTC(now);
  return { yearMonth: today.slice(0, 7), monthStart: monthStart(today), monthEnd: monthEnd(today), today };
}

/** Percent change, or null when either side is missing or the base is zero. */
export function pctChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export { addDays as addDaysYmd };
