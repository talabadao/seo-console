import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { accessTokenFor } from "@/lib/google/oauth";
import { fetchLiveReport, fold, type BreakdownRow } from "@/lib/gscLive";
import {
  resolveComparison,
  resolveRange,
  type CompareMode,
  type Grain,
  type PresetId,
} from "@/lib/dateRanges";
import { applyFilters, filterActive, type FilterState } from "@/lib/queryFilters";
import { siteConfigFor } from "@/lib/siteConfig";
import type { SearchType } from "@/lib/google/searchconsole";

export const maxDuration = 120;

const DIMENSIONS = ["query", "page", "country", "device"];
const SEARCH_TYPES: SearchType[] = ["web", "image", "video", "news", "discover"];

function parseFilters(p: URLSearchParams): FilterState {
  return {
    branded: (["all", "branded", "nonbranded"].includes(p.get("branded") || "")
      ? p.get("branded")
      : "all") as FilterState["branded"],
    position: ([0, 3, 10, 20].includes(Number(p.get("position")))
      ? Number(p.get("position"))
      : 0) as FilterState["position"],
    question: p.get("question") === "1",
    longtail: p.get("longtail") === "1",
    ai: p.get("ai") === "1",
    contains: p.get("contains") || "",
    trend: (["all", "growing", "decaying", "new"].includes(p.get("trend") || "")
      ? p.get("trend")
      : "all") as FilterState["trend"],
  };
}

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
  const trendParam = p.get("trend") || "all";
  // Growing / Decaying / New need a baseline even if the user hasn't turned on a
  // visible comparison — fall back to the previous period for those.
  const effectiveCompare: CompareMode =
    compareMode === "none" && trendParam !== "all" ? "previous" : compareMode;
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
  // 0 / absent -> return everything we fetched (bounded by LIVE_MAX_ROWS).
  const limitParam = Number(p.get("limit") || 0);
  const limit = limitParam > 0 ? Math.min(limitParam, 200000) : Infinity;
  const filters = parseFilters(p);

  let token: string;
  try {
    token = await accessTokenFor(user);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "auth" },
      { status: 502 },
    );
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
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  const filtered = applyFilters(report.breakdown, filters, sc.config, dimension);
  const active = filterActive(filters);

  // When a filter narrows the set, the headline numbers should reflect it.
  const displayTotals = active
    ? fold(filtered)
    : report.totals;
  const displayPrevTotals =
    previous && active
      ? fold(
          filtered.map((r) => ({
            clicks: r.prevClicks,
            impressions: r.prevImpressions,
            position: r.prevPosition,
          })),
        )
      : report.prevTotals;

  const sliced: BreakdownRow[] = isFinite(limit) ? filtered.slice(0, limit) : filtered;

  return NextResponse.json({
    property,
    range: current,
    compareRange: previous,
    grain,
    dimension,
    searchType,
    totals: displayTotals,
    prevTotals: displayPrevTotals,
    series: report.series,
    prevSeries: report.prevSeries,
    breakdown: sliced,
    breakdownCount: filtered.length,
    truncated: report.truncated,
    filterActive: active,
    brandTerms: sc.config.brandTerms,
  });
}
