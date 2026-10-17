// What the shared cache knows how to refresh. Each kind wraps the existing read-only provider code; the query
// holds everything that identifies the result (project, part, exact period, options, config version) and
// nothing secret. Freshness defaults follow the product spec and can be tuned after measurement:
//   Search Console 6 h · GA4 / KPI / LLMs Traffic 2 h · Asana 15 min · SE Ranking 12 h · index health 6 h.
// A section in the "error" state is a failed refresh (the previous result is kept), not a result to cache.

import { createHash } from "node:crypto";
import { db, tableExists } from "@/lib/db";
import { userById } from "@/lib/session";
import { projectById, type Project } from "@/lib/projects";
import { projectGsc } from "@/lib/access";
import { ConnectionUnavailableError } from "@/lib/google/connections";
import { aiDomainsForProject } from "@/lib/gaConfig";
import { classifyGaFailure, cleanGaError, getGaMetadata, type GaFieldMeta } from "@/lib/ga4";
import { ProviderBusyError } from "./providerHttp";
import { runTemplate, type LeadSetup, type TemplateId, type TemplateResult } from "@/lib/v2/ga4reports/templates";
import { runCustomReport, type CustomResult } from "@/lib/v2/ga4reports/run";
import type { ReportSpec } from "@/lib/v2/ga4reports/spec";
import type { PeriodInfo, Section, SummaryPart } from "@/lib/v2/summary/types";
import { ga4Section, gaContext, gscSection, healthSection, kpiSection, projectToken, rankingsSection, tasksSection } from "@/lib/v2/summary/live";
import { llmReport, type Granularity, type LlmMetric } from "@/lib/v2/llm/report";
import { peek, registerKind } from "./cache";
import { SeRankingError } from "@/lib/seranking/client";
import { listSites, matchSite } from "@/lib/seranking/rankings";
import { fetchRawReport, reportRange, type SeRawReport } from "@/lib/seranking/report";
import { seRankingSiteFor } from "@/lib/projectSettings";
import { hostOf } from "@/lib/seranking/client";
import type { SeSite } from "@/lib/seranking/metrics";
import {
  fetchAudit,
  fetchBacklinks,
  fetchCompetition,
  fetchCompetitors,
  fetchEngines,
  fetchHistory,
  fetchKeywords,
  fetchRivals,
  fetchSummary,
  message as seMessage,
} from "@/lib/seranking/donor/fetch";
import { fetchLinkProfile } from "@/lib/seranking/donor/backlinks";
import { linkProfileDecision } from "@/lib/seranking/dataApi";
import { CapReached, adjustAllowances, completeUsage, reserveUsage, takeAllowances } from "@/lib/providers/ledger";
import { LINK_PROFILE_CREDITS, type SeLinkProfile } from "@/lib/seranking/donor/types";
import type { SeAudit, SeBacklinks, SeCompetition, SeCompetitor, SeEngine, SeKeyword, SeRival, SeSeries, SeSnapshot, SeSummary } from "@/lib/seranking/donor/types";

const H = 3600_000;
export const FRESH: Record<string, number> = {
  "summary:gsc": 6 * H,
  "summary:ga4": 2 * H,
  "summary:kpi": 2 * H,
  "summary:tasks": 15 * 60_000,
  "summary:health": 6 * H,
  "summary:rankings": 12 * H,
  "llm-traffic": 2 * H,
  "seranking:report": 12 * H,
};

export class AccessLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessLostError";
  }
}
class SectionFailed extends Error {}

const isAccess = (e: unknown) => e instanceof AccessLostError || (e instanceof Error && /\b(401|403)\b|permission|forbidden/i.test(e.message));

/**
 * A short hash of everything outside the period that changes a project's numbers: linked properties and the shared
 * connections that read them, Asana and SE Ranking mappings, lead events, the project's AI source domains and KPI
 * targets. Part of every cache key, so changing any of them (including switching a mapping to another connection)
 * makes the next read refetch instead of serving the old result. Never depends on who is viewing.
 */
export async function projectConfigVersion(project: Project): Promise<string> {
  const settings = (await tableExists("project_settings"))
    ? ((await db.prepare("SELECT lead_events, seranking_site_id FROM project_settings WHERE project_id = ?").get(project.id)) as Record<string, unknown> | undefined)
    : undefined;
  const targets = (await tableExists("kpi_targets"))
    ? ((await db.prepare("SELECT COUNT(*) AS n, MAX(updated_at) AS at FROM kpi_targets WHERE project_id = ?").get(project.id)) as Record<string, unknown> | undefined)
    : undefined;
  const parts = [
    project.gscProperty,
    project.gscConnectionId,
    project.gaPropertyId,
    project.gaConnectionId,
    project.asanaProjectGid,
    project.asanaConnectionId,
    project.websiteUrl,
    settings?.lead_events ?? null,
    settings?.seranking_site_id ?? null,
    (await aiDomainsForProject(project.id)).join(","),
    targets ? `${targets.n}:${targets.at}` : null,
  ];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

/** The live workspace project a job is for (rechecked when it runs). */
async function context(projectId: number | null): Promise<{ project: Project }> {
  const project = projectId == null ? null : await projectById(projectId);
  if (!project) throw new AccessLostError("The project was deleted or is no longer in the workspace.");
  return { project };
}

/** A Google token through the project's mapped connection. */
async function token(project: Project, kind: "gsc" | "ga4", source: string): Promise<string> {
  const t = await projectToken(project, kind, source);
  if ("token" in t) return t.token;
  // A connection to reconnect, or no mapping: hide cached Google data until it is fixed.
  if (t.error.state === "unavailable" || t.error.state === "not-connected") throw new AccessLostError(t.error.message ?? "Google access is unavailable.");
  throw new SectionFailed(t.error.message ?? "Couldn't get Google access.");
}

function settle<T>(section: Section<T>): { payload: Section<T>; dataThrough?: string | null } {
  if (section.state === "error") {
    const message = section.message ?? "The provider request failed.";
    throw isAccess(new Error(message)) ? new AccessLostError(message) : new SectionFailed(message);
  }
  return { payload: section, dataThrough: section.dataThrough ?? null };
}

export interface SummaryQuery {
  projectId: number;
  part: Exclude<SummaryPart, "content">;
  period: PeriodInfo;
  detail: boolean;
  config: string;
}

for (const part of ["gsc", "ga4", "kpi", "tasks", "health", "rankings"] as const) {
  registerKind<SummaryQuery, Section<unknown>>({
    kind: `summary:${part}`,
    provider: part === "gsc" ? "gsc" : part === "ga4" || part === "kpi" ? "ga4" : part === "tasks" ? "asana" : part === "rankings" ? "seranking" : "local",
    freshMs: FRESH[`summary:${part}`],
    isAccessError: isAccess,
    async run({ projectId, query }) {
      const { project } = await context(projectId);
      if (part === "gsc") {
        const access = await projectGsc(project);
        const siteId = access instanceof ConnectionUnavailableError ? null : access.siteId;
        return settle(await gscSection(siteId, await token(project, "gsc", "Google Search Console"), project, query.period, query.detail));
      }
      if (part === "ga4") return settle(await ga4Section(await token(project, "ga4", "Google Analytics 4"), project, query.period, query.detail));
      if (part === "kpi") return settle(await kpiSection(await token(project, "ga4", "Monthly targets (KPI settings) and GA4"), project));
      if (part === "tasks") return settle(await tasksSection(project));
      if (part === "health") return settle(await healthSection(project));
      return settle(await rankingsSection(project, query.period));
    },
  });
}

export interface LlmQuery {
  projectId: number;
  period: PeriodInfo;
  metric: LlmMetric;
  granularity: Granularity;
  platform: string;
  config: string;
}

registerKind<LlmQuery, unknown>({
  kind: "llm-traffic",
  provider: "ga4",
  freshMs: FRESH["llm-traffic"],
  isAccessError: isAccess,
  async run({ projectId, query }) {
    const { project } = await context(projectId);
    if (!project.gaPropertyId || project.gaConnectionId == null) throw new SectionFailed("No GA4 property linked.");
    const t = await token(project, "ga4", "Google Analytics 4");
    try {
      const { timeZone } = await gaContext(project.gaConnectionId, t, project.gaPropertyId);
      const report = await llmReport({
        token: t,
        propertyId: project.gaPropertyId,
        timeZone,
        aiDomains: await aiDomainsForProject(project.id),
        period: query.period,
        metric: query.metric,
        granularity: query.granularity,
        platformFilter: query.platform,
      });
      return { payload: report };
    } catch (e) {
      const message = cleanGaError(e instanceof Error ? e.message : String(e)).message;
      throw isAccess(e) ? new AccessLostError(message) : new SectionFailed(message);
    }
  },
});

export interface SeReportQuery {
  projectId: number;
  /** Days shown; the range ends on the day the job runs, so a saved report stays usable across midnight. */
  days: number;
  config: string;
}

/** A finished SE Ranking read: the report, or why there is none (these are results, not failures). */
export type SeReportPayload =
  | { status: "ok"; raw: SeRawReport }
  | { status: "not-mapped"; chosenMissing: boolean }
  | { status: "no-data"; message: string; site: { id: number; title: string; url: string } };

registerKind<SeReportQuery, SeReportPayload>({
  kind: "seranking:report",
  provider: "seranking",
  freshMs: FRESH["seranking:report"],
  isAccessError: (e) => e instanceof AccessLostError || (e instanceof SeRankingError && (e.status === 401 || e.status === 403)),
  async run({ projectId, query }) {
    const { project } = await context(projectId);
    const sites = await listSites();
    const chosen = await seRankingSiteFor(project.id);
    const site = chosen ? sites.find((x) => x.id === chosen) : matchSite(sites, project.websiteUrl);
    if (!site) return { payload: { status: "not-mapped", chosenMissing: Boolean(chosen) } };
    const { from, to } = reportRange(query.days);
    const raw = await fetchRawReport(site, from, to);
    const latest = Object.values(raw.keywords)
      .flatMap((ks) => ks.flatMap((k) => k.positions.map((p) => p.date)))
      .sort()
      .at(-1);
    if (!raw.engines.length) return { payload: { status: "no-data", message: "This SE Ranking project has no search engines configured.", site: raw.site } };
    if (!latest) return { payload: { status: "no-data", message: "SE Ranking has no checks for this project in the selected period.", site: raw.site } };
    return { payload: { status: "ok", raw }, dataThrough: latest };
  },
});

// --- SE Ranking modules (ported from AI Brand Mention; lib/seranking/donor) ---------------------------------------
// One explicit site mapping per project (Project settings → Integrations, else the website match), shared with the
// report above. Each module is its own cached dataset, so opening one never refetches the others:
// - overview:     summary, engines, 180-day history (avg position, visibility, top 10), Backlink Monitor stats (~6 requests)
// - competition:  tracked competitors, the top-10 domains for the highest-volume keywords, competitors' positions (~60–70)
// - audit:        the latest EXISTING site audit and its report; never starts a crawl (1–2)
// - linkprofile:  SE Ranking Data API backlink profile — costs credits; refreshed only by an explicit, budgeted action
// All are Project API reads (subscription limits, no credits) except linkprofile.

export interface SeModuleQuery {
  projectId: number;
  config: string;
}

export type SeModulePayload<T> =
  | ({ status: "ok"; site: { id: number; title: string; url: string } } & T)
  | { status: "not-mapped"; chosenMissing: boolean };

export async function siteForProject(project: { id: number; websiteUrl: string }): Promise<{ site: SeSite } | { site: null; chosenMissing: boolean }> {
  const sites = await listSites();
  const chosen = await seRankingSiteFor(project.id);
  const site = chosen ? sites.find((x) => x.id === chosen) : matchSite(sites, project.websiteUrl);
  return site ? { site } : { site: null, chosenMissing: Boolean(chosen) };
}

const seAccess = (e: unknown) => e instanceof AccessLostError || (e instanceof SeRankingError && (e.status === 401 || e.status === 403));
const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Keywords whose top 10 is read for the competition view (one Project API request each, highest volume first).
 * The donor read 100 in one go; here they're read in batches of COMPETITION_BATCH so each job stays well inside a
 * function's time limit and the shared 5 req/s window. A refresh that finds the dataset incomplete is due again
 * after COMPETITION_CONTINUE_MS, so the next read or scheduled tick reads the next batch.
 */
export const COMPETITION_SERP_KEYWORDS = 100;
export const COMPETITION_BATCH = 40;
export const COMPETITION_CONTINUE_MS = 10_000;

registerKind<SeModuleQuery, SeModulePayload<{ summary: SeSummary | null; engines: SeEngine[]; history: SeSnapshot["history"]; backlinks: SeBacklinks | null; errors: SeSnapshot["errors"] }>>({
  kind: "seranking:overview",
  provider: "seranking",
  freshMs: FRESH["seranking:report"],
  isAccessError: seAccess,
  async run({ projectId }) {
    const { project } = await context(projectId);
    const m = await siteForProject(project);
    if (!m.site) return { payload: { status: "not-mapped", chosenMissing: m.chosenMissing } };
    const site = m.site;
    const to = isoDay(Date.now());
    const from = isoDay(Date.now() - 180 * DAY);
    const errors: SeSnapshot["errors"] = {};
    const soft = async <T,>(section: keyof SeSnapshot["errors"], run: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await run();
      } catch (e) {
        if (seAccess(e)) throw e;
        errors[section] = seMessage(e);
        return fallback;
      }
    };
    const [summary, engines, avgPos, visibility, top10, backlinks] = await Promise.all([
      soft("summary", () => fetchSummary(site.id), null),
      soft("engines", () => fetchEngines(site.id), [] as SeEngine[]),
      soft("history", () => fetchHistory(site.id, "avg_pos", from, to), [] as SeSeries[]),
      soft("history", () => fetchHistory(site.id, "visibility_percent", from, to), [] as SeSeries[]),
      soft("history", () => fetchHistory(site.id, "top10", from, to), [] as SeSeries[]),
      soft("backlinks", () => fetchBacklinks(site.id), null),
    ]);
    for (const e of engines) e.name = [...avgPos, ...visibility].find((x) => x.engineId === e.id)?.name ?? `Search engine ${e.searchEngineId}`;
    engines.sort((a, b) => b.keywordCount - a.keywordCount);
    const last = [...avgPos, ...visibility].flatMap((x) => x.points.map((p) => p.date)).sort().at(-1) ?? null;
    return {
      payload: { status: "ok", site: { id: site.id, title: site.title, url: site.url }, summary, engines, history: { avg_pos: avgPos, visibility_percent: visibility, top10 }, backlinks, errors },
      dataThrough: last,
    };
  },
});

registerKind<SeModuleQuery, SeModulePayload<{ engines: SeEngine[]; keywords: SeKeyword[]; competitors: SeCompetitor[]; competition: SeCompetition | null; rivals: SeRival[]; errors: SeSnapshot["errors"] }>>({
  kind: "seranking:competition",
  provider: "seranking",
  freshMs: 24 * H,
  freshFor: (p) => (p.status === "ok" && p.competition?.coverage && !p.competition.coverage.complete ? COMPETITION_CONTINUE_MS : 24 * H),
  isAccessError: seAccess,
  async run({ projectId, query, workspaceId }) {
    const { project } = await context(projectId);
    const m = await siteForProject(project);
    if (!m.site) return { payload: { status: "not-mapped", chosenMissing: m.chosenMissing } };
    const site = m.site;
    const to = isoDay(Date.now());
    const from30 = isoDay(Date.now() - 30 * DAY);
    const earlier = await peek<SeModulePayload<{ competition: SeCompetition | null; rivals: SeRival[] }>>({ kind: "seranking:competition", workspaceId, query });
    const before = earlier.payload?.status === "ok" ? earlier.payload : null;
    const errors: SeSnapshot["errors"] = {};
    const [engines, names, keywords, competitors] = await Promise.all([
      fetchEngines(site.id),
      fetchHistory(site.id, "avg_pos", isoDay(Date.now() - 3 * DAY), to).catch(() => [] as SeSeries[]),
      fetchKeywords(site.id, from30, to),
      fetchCompetitors(site.id).catch((e) => {
        if (seAccess(e)) throw e;
        errors.competitors = seMessage(e);
        return [] as SeCompetitor[];
      }),
    ]);
    for (const e of engines) e.name = names.find((x) => x.engineId === e.id)?.name ?? `Search engine ${e.searchEngineId}`;
    engines.sort((a, b) => b.keywordCount - a.keywordCount);
    const main = engines[0];
    const lastCheck = keywords.filter((k) => k.engineId === main?.id).flatMap((k) => k.positions.map((p) => p.date)).sort().at(-1);
    let competition: SeCompetition | null = null;
    if (main && lastCheck) {
      try {
        competition = await fetchCompetition(site.id, main, lastCheck, keywords, hostOf(site.url), competitors, {
          limit: COMPETITION_SERP_KEYWORDS,
          batch: COMPETITION_BATCH,
          previous: before?.competition ?? null,
        });
      } catch (e) {
        if (seAccess(e)) throw e;
        errors.competition = seMessage(e);
      }
    }
    // Tracked competitors' positions don't depend on the batch: carry them forward while a batch sequence continues.
    const continuing = Boolean(before?.competition && competition && before.competition.date === competition.date && before.rivals?.length);
    const rivals = continuing ? before!.rivals : await fetchRivals(competitors, from30, to, errors);
    return {
      payload: { status: "ok", site: { id: site.id, title: site.title, url: site.url }, engines, keywords, competitors, competition, rivals, errors },
      dataThrough: lastCheck ?? null,
    };
  },
});

registerKind<SeModuleQuery, SeModulePayload<{ audit: SeAudit | null }>>({
  kind: "seranking:audit",
  provider: "seranking",
  freshMs: 24 * H,
  isAccessError: seAccess,
  async run({ projectId }) {
    const { project } = await context(projectId);
    const m = await siteForProject(project);
    if (!m.site) return { payload: { status: "not-mapped", chosenMissing: m.chosenMissing } };
    const audit = await fetchAudit(m.site.id, hostOf(m.site.url));
    return { payload: { status: "ok", site: { id: m.site.id, title: m.site.title, url: m.site.url }, audit }, dataThrough: audit?.lastUpdate?.slice(0, 10) ?? null };
  },
});

registerKind<SeModuleQuery, SeModulePayload<{ linkProfile: SeLinkProfile; competitors: SeCompetitor[] }>>({
  kind: "seranking:linkprofile",
  provider: "seranking-data",
  freshMs: 7 * 24 * H,
  // Costs Data API credits: refreshed only by the explicit, budgeted action (POST /api/v2/seranking/<id>/backlinks).
  manualOnly: true,
  isAccessError: seAccess,
  async run({ userId, projectId }) {
    const { project } = await context(projectId);
    // Manual only: the person who asked for this paid refresh is the payer; a refresh with no actor never runs.
    if (userId == null) throw new SectionFailed("A paid refresh needs the person who asked for it.");
    const user = await userById(userId);
    if (!user) throw new SectionFailed("The person who asked for this refresh can no longer act.");
    const m = await siteForProject(project);
    if (!m.site) return { payload: { status: "not-mapped", chosenMissing: m.chosenMissing } };
    const decision = linkProfileDecision(user.id);
    if (!decision.allowed) throw new SectionFailed(decision.reason);
    try {
      await takeAllowances(decision.allowances, LINK_PROFILE_CREDITS);
    } catch (e) {
      throw new SectionFailed(e instanceof CapReached ? `${e.message} Raise SERANKING_DATA_CREDITS_MONTH or wait for next month.` : String(e));
    }
    const usageId = await reserveUsage({ userId: user.id, projectId: project.id, provider: "seranking-data", operation: "backlink-profile", units: LINK_PROFILE_CREDITS, unitType: "call" });
    const competitors = await fetchCompetitors(m.site.id).catch(() => [] as SeCompetitor[]);
    try {
      const linkProfile = await fetchLinkProfile(m.site.url, competitors);
      await completeUsage(usageId, { ok: true });
      return { payload: { status: "ok", site: { id: m.site.id, title: m.site.title, url: m.site.url }, linkProfile, competitors }, dataThrough: linkProfile.fetchedAt.slice(0, 10) };
    } catch (e) {
      // The summary call failed, so no profile and (per SE Ranking) no credits for the failed calls: give the allowance back.
      await adjustAllowances(decision.allowances.map((a) => a.key), -LINK_PROFILE_CREDITS).catch(() => {});
      await completeUsage(usageId, { ok: false, error: seMessage(e) });
      throw e;
    }
  },
});

/** Imported for its side effect: registering every kind before a job runs. */
export const KINDS_REGISTERED = true;

// ---------- GA4 reports (Analytics (GA4) → GA4 reports) ----------
// The query carries the property, the resolved period (in the property's time zone), the view and the lead
// events, so each is part of the cache identity; the account scope comes from the cache itself.

export interface Ga4TemplateQuery {
  projectId: number;
  propertyId: string;
  template: TemplateId;
  view: string;
  focus: string[];
  leads: string[];
  leadSource: LeadSetup["source"];
  period: PeriodInfo;
  config: string;
}

export interface Ga4CustomQuery {
  projectId: number;
  propertyId: string;
  spec: ReportSpec;
  period: PeriodInfo;
  config: string;
}

export interface Ga4MetadataQuery {
  projectId: number;
  propertyId: string;
}

/** The project still uses the property the query was made for, and the account still lists it. */
async function ga4Context(projectId: number | null, propertyId: string) {
  const { project } = await context(projectId);
  if (project.gaPropertyId !== propertyId) throw new AccessLostError("The project's GA4 property changed.");
  const listed = project.gaConnectionId != null && (await db.prepare("SELECT 1 FROM ga_properties WHERE connection_id = ? AND property_id = ?").get(project.gaConnectionId, propertyId));
  if (!listed) throw new AccessLostError("The project's Google connection no longer lists the linked GA4 property.");
  return { project, token: await token(project, "ga4", "Google Analytics 4") };
}

/** GA4 rejected the request itself (HTTP 400): the same definition would fail again, so it isn't retried. */
class GaRequestRejected extends Error {}

const gaFailure = (e: unknown) => {
  // Rate limits keep their own handling: the job waits for the provider without using up an attempt.
  if (e instanceof ProviderBusyError) return e;
  const f = classifyGaFailure(e);
  if (f.kind === "access" || isAccess(e)) return new AccessLostError(f.message);
  return f.kind === "invalid" ? new GaRequestRejected(f.message) : new SectionFailed(f.message);
};
const gaPermanent = (e: unknown) => e instanceof GaRequestRejected;

registerKind<Ga4TemplateQuery, TemplateResult>({
  kind: "ga4:template",
  provider: "ga4",
  isPermanentError: gaPermanent,
  freshMs: 2 * H,
  // GA4 reports refresh when read, not on the 4-hourly schedule: many views and saved reports, explicit use.
  noSchedule: true,
  isAccessError: isAccess,
  async run({ projectId, query }) {
    const { token: t } = await ga4Context(projectId, query.propertyId);
    try {
      const payload = await runTemplate({
        token: t,
        propertyId: query.propertyId,
        period: query.period,
        query: { template: query.template, view: query.view, focus: query.focus },
        leadEvents: { events: query.leads, source: query.leadSource },
      });
      return { payload };
    } catch (e) {
      throw gaFailure(e);
    }
  },
});

registerKind<Ga4CustomQuery, CustomResult>({
  kind: "ga4:custom",
  provider: "ga4",
  isPermanentError: gaPermanent,
  freshMs: 2 * H,
  noSchedule: true,
  isAccessError: isAccess,
  async run({ projectId, query }) {
    const { token: t } = await ga4Context(projectId, query.propertyId);
    try {
      return { payload: await runCustomReport({ token: t, propertyId: query.propertyId, spec: query.spec, period: query.period }) };
    } catch (e) {
      throw gaFailure(e);
    }
  },
});

registerKind<Ga4MetadataQuery, { dimensions: GaFieldMeta[]; metrics: GaFieldMeta[] }>({
  kind: "ga4:metadata",
  provider: "ga4",
  isPermanentError: gaPermanent,
  freshMs: 24 * H,
  noSchedule: true,
  isAccessError: isAccess,
  async run({ projectId, query }) {
    const { token: t } = await ga4Context(projectId, query.propertyId);
    try {
      return { payload: await getGaMetadata(t, query.propertyId) };
    } catch (e) {
      throw gaFailure(e);
    }
  },
});
