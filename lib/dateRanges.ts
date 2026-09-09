import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfQuarter,
  format,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  subDays,
  subMonths,
  subQuarters,
  subWeeks,
  subYears,
} from "date-fns";

export type Grain = "day" | "week" | "month";

export type PresetId =
  | "today"
  | "yesterday"
  | "7d"
  | "14d"
  | "28d"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "thisQuarter"
  | "lastQuarter"
  | "ytd"
  | "3m"
  | "6m"
  | "8m"
  | "12m"
  | "16m"
  | "custom";

export type CompareMode = "none" | "previous" | "yoy" | "prevMonth" | "custom";

export interface Range {
  start: string;
  end: string;
}

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
  { id: "14d", label: "Last 14 days" },
  { id: "28d", label: "Last 28 days" },
  { id: "lastWeek", label: "Last week" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "thisQuarter", label: "This quarter" },
  { id: "lastQuarter", label: "Last quarter" },
  { id: "ytd", label: "Year to date" },
  { id: "3m", label: "Last 3 months" },
  { id: "6m", label: "Last 6 months" },
  { id: "8m", label: "Last 8 months" },
  { id: "12m", label: "Last 12 months" },
  { id: "16m", label: "Last 16 months" },
  { id: "custom", label: "Custom period" },
];

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * GSC has data through roughly yesterday, and only back ~16 months. We clamp the
 * end to `anchor` (default: yesterday) and never claim data older than 16 months.
 */
export function resolveRange(
  preset: PresetId,
  opts: { customStart?: string; customEnd?: string; anchor?: Date } = {},
): Range {
  const now = opts.anchor ?? new Date();
  const end = subDays(now, 1); // GSC data typically lags ~2 days
  const e = ymd(end);

  switch (preset) {
    case "today":
      return { start: ymd(now), end: ymd(now) };
    case "yesterday":
      return { start: ymd(subDays(now, 1)), end: ymd(subDays(now, 1)) };
    case "custom":
      return {
        start: opts.customStart ?? ymd(subDays(end, 27)),
        end: opts.customEnd ?? e,
      };
    case "7d":
      return { start: ymd(subDays(end, 6)), end: e };
    case "14d":
      return { start: ymd(subDays(end, 13)), end: e };
    case "28d":
      return { start: ymd(subDays(end, 27)), end: e };
    case "lastWeek": {
      const thisWeekMon = startOfWeek(end, { weekStartsOn: 1 });
      const lastMon = subWeeks(thisWeekMon, 1);
      return { start: ymd(lastMon), end: ymd(addDays(lastMon, 6)) };
    }
    case "thisMonth":
      return { start: ymd(startOfMonth(end)), end: e };
    case "lastMonth": {
      const lm = subMonths(end, 1);
      return { start: ymd(startOfMonth(lm)), end: ymd(endOfMonth(lm)) };
    }
    case "thisQuarter":
      return { start: ymd(startOfQuarter(end)), end: e };
    case "lastQuarter": {
      const lq = subQuarters(end, 1);
      return { start: ymd(startOfQuarter(lq)), end: ymd(endOfQuarter(lq)) };
    }
    case "ytd":
      return { start: `${end.getFullYear()}-01-01`, end: e };
    case "3m":
      return { start: ymd(subMonths(end, 3)), end: e };
    case "6m":
      return { start: ymd(subMonths(end, 6)), end: e };
    case "8m":
      return { start: ymd(subMonths(end, 8)), end: e };
    case "12m":
      return { start: ymd(subMonths(end, 12)), end: e };
    case "16m":
      return { start: ymd(subMonths(end, 16)), end: e };
  }
}

export function spanDays(r: Range): number {
  return differenceInCalendarDays(parseISO(r.end), parseISO(r.start)) + 1;
}

export function resolveComparison(
  current: Range,
  mode: CompareMode,
  opts: { matchWeekdays?: boolean; customStart?: string; customEnd?: string } = {},
): Range | null {
  if (mode === "none") return null;
  const cs = parseISO(current.start);
  const ce = parseISO(current.end);
  const len = differenceInCalendarDays(ce, cs) + 1;

  if (mode === "custom") {
    return {
      start: opts.customStart ?? ymd(subDays(cs, len)),
      end: opts.customEnd ?? ymd(subDays(cs, 1)),
    };
  }

  if (mode === "yoy") {
    return { start: ymd(subYears(cs, 1)), end: ymd(subYears(ce, 1)) };
  }

  if (mode === "prevMonth") {
    const pm = subMonths(cs, 1);
    return { start: ymd(startOfMonth(pm)), end: ymd(endOfMonth(pm)) };
  }

  // previous period: immediately preceding window of the same length.
  // "match weekdays" shifts the window back by a whole number of weeks so each
  // day lines up with the same weekday in the current period.
  const shift = opts.matchWeekdays ? Math.ceil(len / 7) * 7 : len;
  const prevStart = subDays(cs, shift);
  return { start: ymd(prevStart), end: ymd(addDays(prevStart, len - 1)) };
}

/** Bucket key for a date at the requested grain. */
export function bucketOf(dateStr: string, grain: Grain): string {
  if (grain === "day") return dateStr;
  const d = parseISO(dateStr);
  if (grain === "month") return format(d, "yyyy-MM");
  return format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export function bucketLabel(bucket: string, grain: Grain): string {
  if (grain === "month") return format(parseISO(bucket + "-01"), "MMM yyyy");
  if (grain === "week") return "Wk " + format(parseISO(bucket), "MMM d");
  return format(parseISO(bucket), "MMM d");
}
