import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { GoogleReauthRequiredError, accessTokenFor } from "@/lib/google/oauth";
import { fetchLiveReport, type CrossFilter } from "@/lib/gscLive";
import {
  resolveComparison,
  resolveRange,
  type CompareMode,
  type Grain,
  type PresetId,
} from "@/lib/dateRanges";
import { siteConfigFor } from "@/lib/siteConfig";
import type { SearchType } from "@/lib/google/searchconsole";

export const maxDuration = 120;

const DIMENSIONS = ["query", "page", "country", "device"];
const SEARCH_TYPES: SearchType[] = ["web", "image", "video", "news", "discover"];

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const property = p.get("property");
  if (!property) return NextResponse.json({ error: "property required" }, { status: 400 });

  const sc = await siteConfigFor(user.id, property);
  if (!sc) return NextResponse.json({ error: "unknown property" }, { status: 404 });

  const preset = (p.get("preset") || "28d") as PresetId;
  const current = resolveRange(preset, {
    customStart: p.get("start") || undefined,
    customEnd: p.get("end") || undefined,
  });
  const compareMode = (p.get("compare") || "none") as CompareMode;
  // Always resolve a previous period, even when no visible comparison is on.
  // The client now applies the Winning/Losing/New, position, branded, AI, etc.
  // filters itself against the rows returned here (so toggling them costs no
  // GSC round trip), and those need each row's previous-period numbers +
  // isNew present. With comparison off we baseline against the immediately
  // preceding window; this doesn't change what the UI shows, since the client
  // only draws comparison deltas when the user actually enables comparison.
  const effectiveCompare: CompareMode = compareMode === "none" ? "previous" : compareMode;
  const previous = resolveComparison(current, effectiveCompare, {
    matchWeekdays: p.get("matchWeekdays") === "1",
    customStart: p.get("compareStart") || undefined,
    customEnd: p.get("compareEnd") || undefined,
  });

  const grain = (["day", "week", "month"].includes(p.get("grain") || "")
    ? p.get("grain")
    : "day") as Grain;
  const dimension = DIMENSIONS.includes(p.get("dimension") || "")
    ? (p.get("dimension") as string)
    : "query";
  const searchType = (SEARCH_TYPES.includes((p.get("searchType") || "web") as SearchType)
    ? p.get("searchType")
    : "web") as SearchType;

  // Cross-dimension scoping is a real GSC dimensionFilter, so it must stay
  // server-side: viewing Queries narrowed to one page, or Pages narrowed to
  // one query. Every other filter is applied on the client against the rows
  // returned here.
  const filterPage = p.get("filterPage") || "";
  const filterQuery = p.get("filterQuery") || "";
  const crossFilter: CrossFilter | undefined =
    dimension === "query" && filterPage
      ? { dimension: "page", operator: "contains", value: filterPage }
      : dimension === "page" && filterQuery
        ? { dimension: "query", operator: "contains", value: filterQuery }
        : undefined;

  let token: string;
  try {
    token = await accessTokenFor(user);
  } catch (e) {
    if (e instanceof GoogleReauthRequiredError) return NextResponse.json({ needsReconnect: true });
    return NextResponse.json({ error: e instanceof Error ? e.message : "auth" }, { status: 502 });
  }

  let report;
  try {
    report = await fetchLiveReport({
      token,
      property,
      current,
      previous,
      searchType,
      grain,
      dimension,
      maxRows: Number(process.env.LIVE_MAX_ROWS || 50000),
      crossFilter,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  return NextResponse.json(
    {
      property,
      range: current,
      compareRange: previous,
      grain,
      dimension,
      searchType,
      totals: report.totals,
      prevTotals: report.prevTotals,
      series: report.series,
      prevSeries: report.prevSeries,
      breakdown: report.breakdown,
      breakdownCount: report.breakdown.length,
      truncated: report.truncated,
      // The client needs these to reproduce the "branded" and "long-tail"
      // filters locally (same logic as lib/queryFilters).
      brandTerms: sc.config.brandTerms,
      longtailMinWords: sc.config.longtailMinWords,
    },
    {
      // GSC historical data is immutable — only the last day or two can still
      // move — so a short private cache makes flipping back to a view you
      // already loaded instant, without risking meaningfully stale numbers.
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
    },
  );
}
