import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { accessTokenFor, hasAnalyticsScope } from "@/lib/google/oauth";
import { ownsGaProperty, aiDomainsFor } from "@/lib/gaConfig";
import {
  KEY_EVENT_FILTER,
  andFilter,
  classifyTraffic,
  cleanGaError,
  eqFilter,
  getPropertyCurrency,
  runReport,
  trendBreakdown,
  type DateRange,
} from "@/lib/ga4";
import {
  bucketLabel,
  bucketOf,
  enumerateBuckets,
  resolveComparison,
  resolveRange,
  type CompareMode,
  type Grain,
  type PresetId,
  type Range,
} from "@/lib/dateRanges";

export const maxDuration = 120;

const iso = (yyyymmdd: string) =>
  yyyymmdd.length === 8
    ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
    : yyyymmdd;

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasAnalyticsScope(user.google_scopes)) {
    return NextResponse.json({ needsReconnect: true }, { status: 200 });
  }

  const p = req.nextUrl.searchParams;
  const propertyId = p.get("propertyId");
  if (!propertyId || !(await ownsGaProperty(user.id, propertyId))) {
    return NextResponse.json({ error: "unknown or unlinked GA property" }, { status: 404 });
  }

  const kind = p.get("kind") || "main";
  const preset = (p.get("preset") || "28d") as PresetId;
  const current: DateRange = (() => {
    const r = resolveRange(preset, {
      customStart: p.get("start") || undefined,
      customEnd: p.get("end") || undefined,
    });
    return { startDate: r.start, endDate: r.end };
  })();
  const compareMode = (p.get("compare") || "none") as CompareMode;
  const prevR = resolveComparison(
    { start: current.startDate, end: current.endDate },
    compareMode,
    { matchWeekdays: p.get("matchWeekdays") === "1" },
  );
  const previous: DateRange | null = prevR
    ? { startDate: prevR.start, endDate: prevR.end }
    : null;
  const grain = (["day", "week", "month"].includes(p.get("grain") || "")
    ? p.get("grain")
    : "day") as Grain;

  const aiDomains = aiDomainsFor(user);

  let token: string;
  try {
    token = await accessTokenFor(user);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "auth" }, { status: 502 });
  }

  // Resolve + cache the property's reporting currency.
  let currency =
    ((await db
      .prepare("SELECT currency_code FROM ga_properties WHERE user_id = ? AND property_id = ?")
      .get(user.id, propertyId)) as { currency_code: string | null } | undefined)?.currency_code ??
    null;
  if (!currency) {
    currency = await getPropertyCurrency(token, propertyId);
    if (currency) {
      await db
        .prepare("UPDATE ga_properties SET currency_code = ? WHERE user_id = ? AND property_id = ?")
        .run(currency, user.id, propertyId);
    }
  }

  try {
    if (kind === "geo") {
      const dim = p.get("geoDim") === "city" ? "city" : "country";
      const geo = await trendBreakdown(token, propertyId, {
        dimensions: [dim],
        metrics: ["sessions", "totalUsers", "totalRevenue", "keyEvents"],
        current,
        previous,
        limit: 5000,
      });
      return NextResponse.json({ dim, currency, rows: geo.rows, sampled: geo.sampled });
    }

    // Optional global filter for the Key Events breakdown, set from the
    // "Source / Medium" dropdown in the Key Events toolbar.
    const keSourceMedium = p.get("sourceMedium") || null;

    // --- main view ---
    const [seriesRep, usersRep, sourceMedium, keyEvents] = await Promise.all([
      runReport(token, propertyId, {
        dimensions: ["date", "sessionSource", "sessionDefaultChannelGroup"],
        metrics: ["sessions"],
        dateRanges: previous ? [current, previous] : [current],
        limit: 100000,
      }),
      // Total Users isn't meaningfully summable across the source/channel
      // breakdown above (a user visiting via two channels would be double
      // counted), so it's queried separately with only "date" — GA4's own
      // per-row dedup keeps this sum accurate.
      runReport(token, propertyId, {
        dimensions: ["date"],
        metrics: ["totalUsers"],
        dateRanges: previous ? [current, previous] : [current],
        limit: 100000,
      }),
      trendBreakdown(token, propertyId, {
        dimensions: ["sessionSourceMedium"],
        metrics: ["sessions", "totalUsers", "totalRevenue", "keyEvents"],
        current,
        previous,
        limit: 5000,
      }),
      trendBreakdown(token, propertyId, {
        dimensions: ["eventName"],
        metrics: ["keyEvents", "totalRevenue", "eventValue"],
        current,
        previous,
        dimensionFilter: keSourceMedium
          ? andFilter(KEY_EVENT_FILTER, eqFilter("sessionSourceMedium", keSourceMedium))
          : KEY_EVENT_FILTER,
        limit: 2000,
      }),
    ]);

    // Bucket the time series into organic / ai / other, zero-filled across
    // every day in range so current/previous always have equal-length,
    // index-aligned buckets (see enumerateBuckets' doc comment) and the
    // chart shows the full selected range instead of stopping at the last
    // day with nonzero traffic.
    type Bucket = { bucket: string; label: string; organic: number; ai: number; other: number };
    const build = (range: number, span: Range) => {
      const m = new Map<string, Bucket>();
      for (const b of enumerateBuckets(span, grain)) {
        m.set(b, { bucket: b, label: bucketLabel(b, grain), organic: 0, ai: 0, other: 0 });
      }
      for (const r of seriesRep.rows) {
        if (r.range !== range) continue;
        const [dateRaw, source, channel] = r.dims;
        const b = bucketOf(iso(dateRaw), grain);
        const row = m.get(b);
        if (!row) continue; // outside the requested span — shouldn't happen
        row[classifyTraffic(source, channel, aiDomains)] += r.metrics[0] ?? 0;
      }
      return [...m.values()];
    };
    const currentSpan: Range = { start: current.startDate, end: current.endDate };
    const previousSpan: Range | null = previous
      ? { start: previous.startDate, end: previous.endDate }
      : null;
    const series = build(0, currentSpan);
    const prevSeries = previousSpan ? build(1, previousSpan) : null;

    const sumUsers = (range: number) =>
      usersRep.rows.filter((r) => r.range === range).reduce((a, r) => a + (r.metrics[0] ?? 0), 0);

    const sum = (s: Bucket[] | null) =>
      (s ?? []).reduce(
        (a, x) => ({
          organic: a.organic + x.organic,
          ai: a.ai + x.ai,
          other: a.other + x.other,
          sessions: a.sessions + x.organic + x.ai + x.other,
        }),
        { organic: 0, ai: 0, other: 0, sessions: 0 },
      );
    const totalsFromKe = (useprev: boolean) =>
      keyEvents.rows.reduce(
        (a, r) => {
          const v = useprev ? r.prev : r.cur;
          return { keyEvents: a.keyEvents + (v[0] ?? 0), revenue: a.revenue + (v[1] ?? 0) };
        },
        { keyEvents: 0, revenue: 0 },
      );

    return NextResponse.json({
      range: { start: current.startDate, end: current.endDate },
      compareRange: previous ? { start: previous.startDate, end: previous.endDate } : null,
      grain,
      currency,
      series,
      prevSeries: prevSeries
        ? prevSeries.map((pt, i) => ({
            ...pt,
            bucket: series[i]?.bucket ?? pt.bucket,
            label: series[i]?.label ?? pt.label,
          }))
        : null,
      totals: { ...sum(series), users: sumUsers(0), ...totalsFromKe(false) },
      prevTotals: previous
        ? { ...sum(prevSeries), users: sumUsers(1), ...totalsFromKe(true) }
        : null,
      sourceMedium: sourceMedium.rows,
      keyEvents: keyEvents.rows,
      keySourceMedium: keSourceMedium,
      sampled: seriesRep.sampled || sourceMedium.sampled || keyEvents.sampled,
      aiDomains,
    });
  } catch (e) {
    const cleaned = cleanGaError(e instanceof Error ? e.message : String(e));
    return NextResponse.json(
      { error: cleaned.message, enableUrl: cleaned.enableUrl },
      { status: 502 },
    );
  }
}
