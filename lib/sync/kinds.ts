// What the shared cache knows how to refresh. Each kind wraps the existing read-only provider code; the query
// holds everything that identifies the result (project, part, exact period, options, config version) and
// nothing secret. Freshness defaults follow the product spec and can be tuned after measurement:
//   Search Console 6 h · GA4 / KPI / LLMs Traffic 2 h · Asana 15 min · SE Ranking 12 h · index health 6 h.
// A section in the "error" state is a failed refresh (the previous result is kept), not a result to cache.

import { createHash } from "node:crypto";
import { db, tableExists } from "@/lib/db";
import { userById } from "@/lib/session";
import { getProject, type Project } from "@/lib/projects";
import { aiDomainsFor } from "@/lib/gaConfig";
import { cleanGaError } from "@/lib/ga4";
import type { UserRow } from "@/lib/session";
import type { PeriodInfo, Section, SummaryPart } from "@/lib/v2/summary/types";
import { ga4Section, gaContext, googleToken, gscSection, healthSection, kpiSection, rankingsSection, tasksSection } from "@/lib/v2/summary/live";
import { llmReport, type Granularity, type LlmMetric } from "@/lib/v2/llm/report";
import { registerKind } from "./cache";
import { SeRankingError } from "@/lib/seranking/client";
import { listSites, matchSite } from "@/lib/seranking/rankings";
import { fetchRawReport, reportRange, type SeRawReport } from "@/lib/seranking/report";
import { seRankingSiteFor } from "@/lib/projectSettings";

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
 * A short hash of everything outside the period that changes a project's numbers: linked properties, Asana and
 * SE Ranking mappings, lead events, AI source domains and KPI targets. Part of every cache key, so changing any
 * of them makes the next read refetch instead of serving the old result.
 */
export async function projectConfigVersion(user: UserRow, project: Project): Promise<string> {
  const settings = (await tableExists("project_settings"))
    ? ((await db.prepare("SELECT lead_events, seranking_site_id FROM project_settings WHERE project_id = ?").get(project.id)) as Record<string, unknown> | undefined)
    : undefined;
  const targets = (await tableExists("kpi_targets"))
    ? ((await db.prepare("SELECT COUNT(*) AS n, MAX(updated_at) AS at FROM kpi_targets WHERE project_id = ?").get(project.id)) as Record<string, unknown> | undefined)
    : undefined;
  const parts = [
    project.gscProperty,
    project.gaPropertyId,
    project.asanaProjectGid,
    project.websiteUrl,
    settings?.lead_events ?? null,
    settings?.seranking_site_id ?? null,
    aiDomainsFor(user).join(","),
    targets ? `${targets.n}:${targets.at}` : null,
  ];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

async function context(userId: number, projectId: number | null): Promise<{ user: UserRow; project: Project }> {
  const user = await userById(userId);
  if (!user) throw new AccessLostError("This account can no longer sign in.");
  const project = projectId == null ? null : await getProject(user.id, projectId);
  if (!project) throw new AccessLostError("The project is no longer this account's.");
  return { user, project };
}

async function token(user: UserRow, source: string): Promise<string> {
  const t = await googleToken(user, source);
  if ("token" in t) return t.token;
  // Expired or revoked Google access: hide cached Google data until the account reconnects.
  if (t.error.state === "unavailable") throw new AccessLostError(t.error.message ?? "Google access expired.");
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
    async run({ userId, projectId, query }) {
      const { user, project } = await context(userId, projectId);
      if (part === "gsc") return settle(await gscSection(await token(user, "Google Search Console"), project, query.period, query.detail));
      if (part === "ga4") return settle(await ga4Section(user, await token(user, "Google Analytics 4"), project, query.period, query.detail));
      if (part === "kpi") return settle(await kpiSection(user, await token(user, "Monthly targets (KPI settings) and GA4"), project));
      if (part === "tasks") return settle(await tasksSection(user, project));
      if (part === "health") return settle(await healthSection(user, project));
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
  async run({ userId, projectId, query }) {
    const { user, project } = await context(userId, projectId);
    if (!project.gaPropertyId) throw new SectionFailed("No GA4 property linked.");
    const t = await token(user, "Google Analytics 4");
    try {
      const { timeZone } = await gaContext(user, t, project.gaPropertyId);
      const report = await llmReport({
        token: t,
        propertyId: project.gaPropertyId,
        timeZone,
        aiDomains: aiDomainsFor(user),
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
  async run({ userId, projectId, query }) {
    const { project } = await context(userId, projectId);
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

/** Imported for its side effect: registering every kind before a job runs. */
export const KINDS_REGISTERED = true;
