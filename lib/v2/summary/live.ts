// Live summary sections: small adapters over the existing Search Console,
// GA4, KPI and Asana services. Server only. Each returns a Section in one of
// the states in ./types — a failed request becomes state "error" with the
// provider's message, never substitute numbers.

import { db } from "@/lib/db";
import type { UserRow } from "@/lib/session";
import type { Project } from "@/lib/projects";
import { GoogleReauthRequiredError, accessTokenFor, hasAnalyticsScope } from "@/lib/google/oauth";
import { searchAnalytics } from "@/lib/google/searchconsole";
import { classifyTraffic, cleanGaError, getPropertyMeta, propertyNow, runReport, Semaphore } from "@/lib/ga4";
import { aiDomainsFor, ownsGaProperty } from "@/lib/gaConfig";
import { buildKpiCard, configFor, leadsPair, reportWindows, trafficPair } from "@/lib/weeklyReport";
import { fetchProjectTasks, getProject as getAsanaProject } from "@/lib/asana";
import { siteIdFor, lastSync } from "@/lib/metrics";
import { addDaysYmd, daysBetween, taskMonth, ymdUTC } from "./period";
import { listSites, matchSite, rankingsFor, seRankingConfigured } from "@/lib/seranking/rankings";
import { seRankingSiteFor } from "@/lib/projectSettings";
import { summarizeTasks } from "./tasks";
import { insightLists } from "./insights";
import { evaluateKpi } from "./kpi";
import type { Ga4Data, GscData, HealthData, KpiData, KpiItem, PeriodInfo, Section, TaskData, RankingsData } from "./types";

/** Caps provider calls from this server instance, across concurrent summary requests. */
export const providerGate = new Semaphore(4);

const GSC = "Google Search Console";
const GA4 = "Google Analytics 4";
const KPI = "Monthly targets (KPI settings) and GA4";
const ASANA = "Asana";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Rows per Search Analytics request for the Insights-style page and query lists. */
const INSIGHT_ROWS = 1000;

/** Search Console normally has data through 2–3 days ago; older than this counts as stale. */
const GSC_STALE_DAYS = 4;

export type TokenResult = { token: string } | { error: Section<never> };

export async function googleToken(user: UserRow, source: string): Promise<TokenResult> {
  try {
    return { token: await accessTokenFor(user) };
  } catch (e) {
    if (e instanceof GoogleReauthRequiredError) {
      return { error: { state: "unavailable", source, message: "Google access expired. Sign out and sign in again to reconnect." } };
    }
    return { error: { state: "error", source, message: errorText(e) } };
  }
}

export async function gscSection(token: string, project: Project, period: PeriodInfo, detail: boolean): Promise<Section<GscData>> {
  if (!project.gscProperty) return { state: "not-connected", source: GSC, message: "No Search Console property linked to this project." };
  const site = project.gscProperty;
  try {
    const totals = (r: { start: string; end: string }) =>
      providerGate.run(() => searchAnalytics(token, site, { startDate: r.start, endDate: r.end, dataState: "all", type: "web" }));
    const [cur, prev, days] = await Promise.all([
      totals(period.current),
      period.previous ? totals(period.previous) : Promise.resolve(null),
      providerGate.run(() =>
        searchAnalytics(token, site, {
          startDate: period.current.start,
          endDate: period.current.end,
          dimensions: ["date"],
          dataState: "all",
          type: "web",
          rowLimit: 500,
        }),
      ),
    ]);
    // Without dimensions Google returns one row with its own period totals:
    // CTR and position come from Google, not from averaging daily values.
    const c = cur[0];
    const p = prev?.[0];
    const pair = (key: "clicks" | "impressions" | "ctr" | "position", fallback: number | null) => ({
      current: c ? c[key] : fallback,
      previous: prev == null ? null : p ? p[key] : fallback,
    });
    const series = days.map((r) => ({ date: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions })).sort((a, b) => (a.date < b.date ? -1 : 1));
    const dataThrough = series.length ? series[series.length - 1].date : null;
    let insights: Pick<GscData, "pages" | "queries"> = {};
    if (detail) {
      // Pages and queries for both periods, by clicks. INSIGHT_ROWS rows per request; when a comparison
      // request comes back full, rows missing from it have unknown (not zero) previous clicks.
      const list = (r: { start: string; end: string }, dim: "page" | "query") =>
        providerGate.run(() =>
          searchAnalytics(token, site, { startDate: r.start, endDate: r.end, dimensions: [dim], dataState: "all", type: "web", rowLimit: INSIGHT_ROWS }),
        );
      const [pc, pp, qc, qp] = await Promise.all([
        list(period.current, "page"),
        period.previous ? list(period.previous, "page") : Promise.resolve(null),
        list(period.current, "query"),
        period.previous ? list(period.previous, "query") : Promise.resolve(null),
      ]);
      const rowsOf = (rows: { keys?: string[]; clicks: number }[] | null) => rows?.map((r) => ({ key: r.keys?.[0] ?? "", clicks: r.clicks })) ?? null;
      insights = {
        pages: insightLists(rowsOf(pc)!, rowsOf(pp), (pp?.length ?? 0) < INSIGHT_ROWS),
        queries: insightLists(rowsOf(qc)!, rowsOf(qp), (qp?.length ?? 0) < INSIGHT_ROWS),
      };
    }
    const staleCutoff = addDaysYmd(ymdUTC(new Date()), -GSC_STALE_DAYS);
    return {
      state: "live",
      source: GSC,
      fetchedAt: Date.now(),
      dataThrough,
      stale: dataThrough == null || dataThrough < staleCutoff,
      data: {
        // No rows at all means no clicks or impressions in the period: a real zero.
        clicks: pair("clicks", 0),
        impressions: pair("impressions", 0),
        ctr: pair("ctr", null),
        position: pair("position", null),
        ...(detail ? { series, ...insights } : {}),
      },
    };
  } catch (e) {
    return { state: "error", source: GSC, message: errorText(e) };
  }
}

export async function gaContext(user: UserRow, token: string, propertyId: string) {
  const row = (await db
    .prepare("SELECT time_zone, currency_code FROM ga_properties WHERE user_id = ? AND property_id = ?")
    .get(user.id, propertyId)) as { time_zone: string | null; currency_code: string | null } | undefined;
  let timeZone = row?.time_zone ?? null;
  let currency = row?.currency_code ?? null;
  if (!timeZone || !currency) {
    const meta = await providerGate.run(() => getPropertyMeta(token, propertyId));
    timeZone = timeZone ?? meta.timeZone;
    currency = currency ?? meta.currency;
  }
  return { timeZone, currency };
}

export async function gaPreconditions(user: UserRow, project: Project, source: string): Promise<Section<never> | null> {
  if (!project.gaPropertyId) return { state: "not-connected", source, message: "No GA4 property linked to this project." };
  if (!hasAnalyticsScope(user.google_scopes)) {
    return { state: "unavailable", source, message: "Google Analytics access hasn't been granted. Sign out and sign in again to allow it." };
  }
  if (!(await ownsGaProperty(user.id, project.gaPropertyId))) {
    return { state: "unavailable", source, message: "This account no longer lists the linked GA4 property." };
  }
  return null;
}

export async function ga4Section(user: UserRow, token: string, project: Project, period: PeriodInfo, detail: boolean): Promise<Section<Ga4Data>> {
  const blocked = await gaPreconditions(user, project, GA4);
  if (blocked) return blocked;
  const propertyId = project.gaPropertyId!;
  try {
    const { currency } = await gaContext(user, token, propertyId);
    const aiDomains = aiDomainsFor(user);
    const ranges = [{ startDate: period.current.start, endDate: period.current.end }];
    if (period.previous) ranges.push({ startDate: period.previous.start, endDate: period.previous.end });
    // Totals from one query without a date dimension, so sessions spanning
    // midnight aren't counted twice. Sessions are additive across sources.
    const { rows } = await providerGate.run(() =>
      runReport(token, propertyId, {
        dimensions: ["sessionSource", "sessionDefaultChannelGroup"],
        metrics: ["sessions", "engagedSessions", "keyEvents", "totalRevenue"],
        dateRanges: ranges,
        limit: 10000,
      }),
    );
    // Scope: sessions, engaged sessions, key events and revenue are Organic Search (AI sources excluded);
    // aiSessions are the sessions whose source is on the AI list, whatever their channel.
    const sums = [0, 1].map((range) => {
      const t = { sessions: 0, ai: 0, engaged: 0, key: 0, revenue: 0 };
      for (const r of rows) {
        if (r.range !== range) continue;
        const kind = classifyTraffic(r.dims[0] ?? "", r.dims[1] ?? "", aiDomains);
        if (kind === "ai") t.ai += r.metrics[0] ?? 0;
        if (kind !== "organic") continue;
        t.sessions += r.metrics[0] ?? 0;
        t.engaged += r.metrics[1] ?? 0;
        t.key += r.metrics[2] ?? 0;
        t.revenue += r.metrics[3] ?? 0;
      }
      return t;
    });
    const [cur, prev] = sums;
    const hasPrev = Boolean(period.previous);
    const pair = (k: keyof typeof cur) => ({ current: cur[k], previous: hasPrev ? prev[k] : null });
    let series: Ga4Data["series"];
    if (detail) {
      const daily = await providerGate.run(() =>
        runReport(token, propertyId, {
          dimensions: ["date", "sessionSource", "sessionDefaultChannelGroup"],
          metrics: ["sessions"],
          dateRanges: [ranges[0]],
          limit: 100000,
        }),
      );
      const byDay = new Map<string, { sessions: number; aiSessions: number }>();
      for (const r of daily.rows) {
        const kind = classifyTraffic(r.dims[1] ?? "", r.dims[2] ?? "", aiDomains);
        if (kind === "other") continue;
        const d = r.dims[0];
        const key = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
        const day = byDay.get(key) ?? { sessions: 0, aiSessions: 0 };
        if (kind === "organic") day.sessions += r.metrics[0] ?? 0;
        else day.aiSessions += r.metrics[0] ?? 0;
        byDay.set(key, day);
      }
      series = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, v]) => ({ date, ...v }));
    }
    const revenueTracked = cur.revenue > 0 || (hasPrev && prev.revenue > 0);
    return {
      state: "live",
      source: GA4,
      fetchedAt: Date.now(),
      dataThrough: period.current.end,
      data: {
        sessions: pair("sessions"),
        aiSessions: pair("ai"),
        engagedSessions: pair("engaged"),
        keyEvents: pair("key"),
        revenue: revenueTracked && currency ? pair("revenue") : null,
        currency: revenueTracked ? currency : null,
        ...(series ? { series } : {}),
      },
    };
  } catch (e) {
    return { state: "error", source: GA4, message: cleanGaError(errorText(e)).message };
  }
}

export async function kpiSection(user: UserRow, token: string, project: Project): Promise<Section<KpiData>> {
  const blocked = await gaPreconditions(user, project, KPI);
  if (blocked) return blocked;
  const propertyId = project.gaPropertyId!;
  try {
    const { timeZone } = await gaContext(user, token, propertyId);
    const w = reportWindows(propertyNow(timeZone));
    const config = await configFor(user.id, propertyId, w.yearMonth);
    const all = [
      { id: "traffic-organic", label: "Organic sessions", target: config.trafficOrganicTarget, kind: "traffic" as const, channel: "organic" as const },
      { id: "traffic-ai", label: "AI search sessions", target: config.trafficAiTarget, kind: "traffic" as const, channel: "ai" as const },
      { id: "lead-organic", label: "Organic leads", target: config.leadOrganicTarget, kind: "leads" as const, channel: "organic" as const },
      { id: "lead-ai", label: "AI search leads", target: config.leadAiTarget, kind: "leads" as const, channel: "ai" as const },
    ];
    const withTarget = all.filter((k) => k.target > 0);
    // Lead KPIs need the project's lead events; without them the KPI is "data unavailable", not zero.
    const wanted = withTarget.filter((k) => k.kind === "traffic" || config.leadEvents.length);
    const notes = withTarget.length > wanted.length ? ["Lead targets are set, but no lead events are chosen. Choose them in Project settings → Analytics."] : [];
    const monthLabel = `${w.monthLabel} ${w.yearMonth.slice(0, 4)}`;
    const base = { yearMonth: w.yearMonth, monthLabel, daysElapsed: w.daysElapsed, daysInMonth: w.daysInMonth, monthComplete: false, leadEvents: config.leadEvents, notes };
    if (!wanted.length) {
      return {
        state: "unavailable",
        source: KPI,
        message: notes[0] ?? `No KPI targets are set for ${monthLabel}. Add them in Project settings → KPI targets.`,
      };
    }
    // One query per kind covering both month-to-date and the last 30 days.
    const span = { start: w.mtd.start < w.last30.start ? w.mtd.start : w.last30.start, end: w.mtd.end };
    const aiDomains = aiDomainsFor(user);
    const needLeads = wanted.some((k) => k.kind === "leads");
    const [traffic, leads] = await Promise.all([
      providerGate.run(() => trafficPair(token, propertyId, span, null, aiDomains)),
      needLeads ? providerGate.run(() => leadsPair(token, propertyId, span, null, aiDomains, config.leadEvents)) : Promise.resolve(null),
    ]);
    const sum = (series: { bucket: string; organic: number; ai: number }[], ch: "organic" | "ai", r: { start: string; end: string }) =>
      series.filter((d) => d.bucket >= r.start && d.bucket <= r.end).reduce((a, d) => a + d[ch], 0);
    const items: KpiItem[] = wanted.map((k) => {
      const series = k.kind === "traffic" ? traffic.series : (leads?.series ?? []);
      const card = buildKpiCard(sum(series, k.channel, w.mtd), sum(series, k.channel, w.last30), k.target, w);
      // The current month is still running, so attainment is "in progress" until the target is reached.
      return evaluateKpi({ id: k.id, label: k.label, direction: "higher", actual: card.actualMtd, target: card.target, projected: card.projected, monthComplete: false });
    });
    return { state: "live", source: KPI, fetchedAt: Date.now(), dataThrough: w.mtd.end, data: { ...base, items } };
  } catch (e) {
    return { state: "error", source: KPI, message: cleanGaError(errorText(e)).message };
  }
}

export async function tasksSection(user: UserRow, project: Project, now: Date = new Date()): Promise<Section<TaskData>> {
  if (!project.asanaProjectGid) return { state: "not-connected", source: ASANA, message: "No Asana project linked to this project." };
  if (!user.asana_api_token) {
    return { state: "unavailable", source: ASANA, message: "No Asana token saved. Add one in Settings → Asana to show tasks." };
  }
  const token = user.asana_api_token;
  try {
    const month = taskMonth(now);
    // Read-only: lists tasks and the project link. Nothing is written to Asana.
    const [tasks, asanaProject] = await Promise.all([
      providerGate.run(() => fetchProjectTasks(token, project.asanaProjectGid, `${month.monthStart}T00:00:00.000Z`)),
      providerGate.run(() => getAsanaProject(token, project.asanaProjectGid)).catch(() => null),
    ]);
    return {
      state: "live",
      source: ASANA,
      fetchedAt: Date.now(),
      data: summarizeTasks(tasks, month, asanaProject?.permalink_url ?? null),
    };
  } catch (e) {
    return { state: "error", source: ASANA, message: errorText(e) };
  }
}

/** Stored history only (no provider calls): last Search Console sync, PageSpeed and reviews failures. */
export async function healthSection(user: UserRow, project: Project): Promise<Section<HealthData>> {
  try {
    const siteId = project.gscProperty ? await siteIdFor(user.id, project.gscProperty) : null;
    const sync = siteId ? await lastSync(siteId) : undefined;
    const weekAgo = addDaysYmd(ymdUTC(new Date()), -7);
    const psi = (await db
      .prepare(
        `SELECT COUNT(*) AS n FROM psi_runs r JOIN psi_pages p ON p.id = r.page_id
          WHERE p.project_id = ? AND r.error IS NOT NULL AND r.run_date >= ?`,
      )
      .get(project.id, weekAgo)) as { n: number | string } | undefined;
    const reviews = (await db
      .prepare("SELECT sync_error FROM gbp_state WHERE project_id = ? AND sync_error IS NOT NULL ORDER BY synced_at DESC NULLS LAST LIMIT 1")
      .get(project.id)) as { sync_error: string } | undefined;
    return {
      state: "live",
      source: "Stored sync history",
      fetchedAt: Date.now(),
      data: {
        lastSync: sync ? { status: sync.status, finishedAt: sync.finished_at, message: sync.message } : null,
        pageSpeedErrors: Number(psi?.n ?? 0),
        reviewsSyncError: reviews?.sync_error ?? null,
      },
    };
  } catch (e) {
    return { state: "error", source: "Stored sync history", message: errorText(e) };
  }
}

const SE_RANKING = "SE Ranking";

/**
 * Keyword rankings from the SE Ranking project mapped to this project (chosen in Project settings, or matched
 * by website). Reads only; about 3 API requests, cached with the rest of the summary.
 */
export async function rankingsSection(project: Project, period: PeriodInfo): Promise<Section<RankingsData>> {
  if (!seRankingConfigured()) {
    return { state: "unavailable", source: SE_RANKING, message: "SE Ranking isn't connected to SEO Console yet (no SE Ranking API key on the server)." };
  }
  try {
    const sites = await listSites();
    const chosen = await seRankingSiteFor(project.id);
    const site = chosen ? sites.find((s) => s.id === chosen) : matchSite(sites, project.websiteUrl);
    if (!site) {
      return {
        state: "not-connected",
        source: SE_RANKING,
        message: chosen
          ? "The SE Ranking project chosen for this project is no longer in the account."
          : "No SE Ranking project tracks this website. Choose one in Project settings → Integrations.",
      };
    }
    const compareDays = period.previous ? daysBetween(period.current.start, period.current.end) : 7;
    const data = await rankingsFor(site, compareDays);
    return { state: "live", source: SE_RANKING, fetchedAt: Date.now(), dataThrough: data.context.latestDate, data };
  } catch (e) {
    return { state: "error", source: SE_RANKING, message: errorText(e) };
  }
}
