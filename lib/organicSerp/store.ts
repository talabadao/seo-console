// Retired multi-engine Organic SERP (16–17 Oct 2026): saved configurations and snapshots (migration 0009), now an
// archive read by Rank tracking → Organic SERP → archive. runSearch is no longer reachable from any route (the run
// endpoint returns 410); it stays for the record-keeping rules its tests document.
//
// - A run is explicit (a button with the expected usage); opening a snapshot only reads the database.
// - Each results page is one metered SerpApi search through lib/providers/serpapi.ts serpSearch, so the account
//   and project limits, the ledger and (on Preview) the cumulative smoke-test allowance all apply. A page the
//   policy refuses is never sent.
// - Billable calls aren't duplicated: an identical search finished in the last hour is shown instead (SerpApi
//   itself serves cached results for an hour) unless "run again" is chosen; an identical run already in flight —
//   from another click, tab or server instance — is joined, not repeated (partial unique index).
// - A run whose later page fails keeps the pages it got, marked "partial" (never complete); the tracked domain
//   is then "not found within the scanned depth", with the depth actually scanned.

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { isDemoWebsite } from "@/lib/v2/summary/demo";
import { NO_SERP_KEY, SerpRefused, serpKey, serpSearch } from "@/lib/providers/serpapi";
import {
  ENGINES,
  belongsTo,
  hasNextPage,
  hostOf,
  maxRequests,
  pageFeatures,
  pageResults,
  requestParams,
  type EngineId,
  type SerpInput,
  type SerpParams,
  type SerpResult,
} from "./engines";

export const REUSE_MS = 60 * 60_000;
/** A run still "running" after this long lost its worker (the function timed out): it's marked failed. */
export const STALE_RUN_MS = 5 * 60_000;
const JOIN_WAIT_MS = 50_000;

export interface SnapshotSummary {
  id: number;
  configId: number | null;
  engine: EngineId;
  params: SerpParams;
  depth: number;
  stopOnFound: boolean;
  status: "running" | "done" | "partial" | "failed";
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  requests: number;
  scanned: number;
  trackedDomain: string | null;
  trackedPosition: number | null;
  trackedUrl: string | null;
  demo: boolean;
}

export interface Snapshot extends SnapshotSummary {
  results: SerpResult[];
  features: string[];
}

export interface SerpConfig {
  id: number;
  name: string;
  engine: EngineId;
  params: SerpParams;
  depth: number;
  stopOnFound: boolean;
  updatedAt: number;
}

const parse = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;

function summary(r: Record<string, unknown>): SnapshotSummary {
  return {
    id: Number(r.id),
    configId: r.config_id == null ? null : Number(r.config_id),
    engine: r.engine as EngineId,
    params: parse<SerpParams>(r.params),
    depth: Number(r.depth),
    stopOnFound: Boolean(r.stop_on_found),
    status: r.status as SnapshotSummary["status"],
    startedAt: Number(r.started_at),
    finishedAt: r.finished_at == null ? null : Number(r.finished_at),
    error: (r.error as string | null) ?? null,
    requests: Number(r.requests ?? 0),
    scanned: Number(r.scanned ?? 0),
    trackedDomain: (r.tracked_domain as string | null) ?? null,
    trackedPosition: r.tracked_position == null ? null : Number(r.tracked_position),
    trackedUrl: (r.tracked_url as string | null) ?? null,
    demo: Boolean(r.demo),
  };
}

const SUMMARY_COLS =
  "id, config_id, engine, params, depth, stop_on_found, status, started_at, finished_at, error, requests, scanned, tracked_domain, tracked_position, tracked_url, demo";

export function paramsHash(input: SerpInput): string {
  const p = input.params as unknown as Record<string, unknown>;
  const canon = Object.keys(p)
    .sort()
    .map((k) => `${k}=${String(p[k]).toLowerCase()}`)
    .join("&");
  return createHash("sha256").update(`${input.engine}|${canon}|${input.depth}|${input.stopOnFound ? 1 : 0}`).digest("hex").slice(0, 32);
}

/** Marks runs whose worker vanished as failed, so they don't block identical runs forever. */
async function expireStale(projectId: number): Promise<void> {
  await db
    .prepare("UPDATE serp_snapshots SET status = 'failed', error = 'The run was interrupted before it finished.', finished_at = ? WHERE project_id = ? AND status = 'running' AND started_at < ?")
    .run(Date.now(), projectId, Date.now() - STALE_RUN_MS);
}

export async function listSnapshots(userId: number, projectId: number, limit = 100): Promise<SnapshotSummary[]> {
  await expireStale(projectId);
  const rows = (await db
    .prepare(`SELECT ${SUMMARY_COLS} FROM serp_snapshots WHERE project_id = ? ORDER BY started_at DESC, id DESC LIMIT ?`)
    .all(projectId, limit)) as Record<string, unknown>[];
  return rows.map(summary);
}

/** One snapshot, from the database only (never searches). */
export async function getSnapshot(userId: number, projectId: number, id: number): Promise<Snapshot | null> {
  const r = (await db.prepare(`SELECT ${SUMMARY_COLS}, results, features FROM serp_snapshots WHERE project_id = ? AND id = ?`).get(projectId, id)) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  return { ...summary(r), results: parse<SerpResult[] | null>(r.results) ?? [], features: parse<string[] | null>(r.features) ?? [] };
}

export async function listConfigs(userId: number, projectId: number): Promise<SerpConfig[]> {
  const rows = (await db
    .prepare("SELECT id, name, engine, params, depth, stop_on_found, updated_at FROM serp_configs WHERE user_id = ? AND project_id = ? ORDER BY name")
    .all(userId, projectId)) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    engine: r.engine as EngineId,
    params: parse<SerpParams>(r.params),
    depth: Number(r.depth),
    stopOnFound: Boolean(r.stop_on_found),
    updatedAt: Number(r.updated_at),
  }));
}

export async function saveConfig(userId: number, projectId: number, name: string, input: SerpInput, id?: number | null): Promise<SerpConfig> {
  const now = Date.now();
  const label = name.trim().slice(0, 120) || `${ENGINES[input.engine].label}: ${input.params.query}`;
  if (id) {
    const r = await db
      .prepare("UPDATE serp_configs SET name = ?, engine = ?, params = ?::jsonb, depth = ?, stop_on_found = ?, updated_at = ? WHERE id = ? AND user_id = ? AND project_id = ?")
      .run(label, input.engine, JSON.stringify(input.params), input.depth, input.stopOnFound, now, id, userId, projectId);
    if (!r.count) throw new Error("That saved search no longer exists.");
  } else {
    const r = (await db
      .prepare(
        "INSERT INTO serp_configs (user_id, project_id, name, engine, params, depth, stop_on_found, created_at, updated_at) VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?) RETURNING id",
      )
      .get(userId, projectId, label, input.engine, JSON.stringify(input.params), input.depth, input.stopOnFound, now, now)) as { id: number };
    id = Number(r.id);
  }
  return { id, name: label, engine: input.engine, params: input.params, depth: input.depth, stopOnFound: input.stopOnFound, updatedAt: now };
}

export async function deleteConfig(userId: number, projectId: number, id: number): Promise<boolean> {
  const r = await db.prepare("DELETE FROM serp_configs WHERE id = ? AND user_id = ? AND project_id = ?").run(id, userId, projectId);
  return r.count > 0;
}

/** One results page: SerpApi parameters in, the response body out. Tests pass a fake. */
export type PageSearch = (params: Record<string, string>) => Promise<Record<string, unknown>>;

export interface RunOutcome {
  snapshot: Snapshot;
  /** An identical finished search from the last hour was shown instead of searching again. */
  reused?: boolean;
  /** An identical run was already in flight and this request waited for it. */
  joined?: boolean;
}

export class RunRefused extends Error {}

/**
 * Runs a search explicitly (see the header). `force` skips the one-hour reuse (it never skips joining an
 * identical run in flight). Throws RunRefused when nothing could be sent (no key, policy, limits).
 */
export async function runSearch(opts: {
  userId: number;
  project: { id: number; websiteUrl: string };
  input: SerpInput;
  configId?: number | null;
  force?: boolean;
  search?: PageSearch;
}): Promise<RunOutcome> {
  const { userId, project, input } = opts;
  const hash = paramsHash(input);
  await expireStale(project.id);
  const demo = isDemoWebsite(project.websiteUrl);

  if (!opts.force) {
    const recent = (await db
      .prepare(`SELECT id FROM serp_snapshots WHERE user_id = ? AND project_id = ? AND params_hash = ? AND status = 'done' AND started_at > ? ORDER BY id DESC LIMIT 1`)
      .get(userId, project.id, hash, Date.now() - REUSE_MS)) as { id: number } | undefined;
    if (recent) return { snapshot: (await getSnapshot(userId, project.id, Number(recent.id)))!, reused: true };
  }

  let search = opts.search;
  if (!search && !demo) {
    const key = await serpKey(userId, project.id);
    if (!key) throw new RunRefused(NO_SERP_KEY);
    search = (params) => serpSearch(params, { userId, projectId: project.id, runId: null, key });
  }

  const tracked = hostOf(project.websiteUrl) || null;
  const created = (await db
    .prepare(
      `INSERT INTO serp_snapshots (user_id, project_id, config_id, engine, params, params_hash, depth, stop_on_found, status, started_at, tracked_domain, demo)
       VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?, 'running', ?, ?, ?)
       ON CONFLICT (project_id, params_hash) WHERE status = 'running' DO NOTHING RETURNING id`,
    )
    .get(userId, project.id, opts.configId ?? null, input.engine, JSON.stringify(input.params), hash, input.depth, input.stopOnFound, Date.now(), tracked, demo)) as
    | { id: number }
    | undefined;

  if (!created) {
    // The same search is already running (another click, tab or instance): wait for it instead of paying twice.
    const deadline = Date.now() + JOIN_WAIT_MS;
    for (;;) {
      const r = (await db.prepare("SELECT id, status FROM serp_snapshots WHERE project_id = ? AND params_hash = ? ORDER BY id DESC LIMIT 1").get(project.id, hash)) as
        | { id: number; status: string }
        | undefined;
      if (r && r.status !== "running") return { snapshot: (await getSnapshot(userId, project.id, Number(r.id)))!, joined: true };
      if (Date.now() > deadline && r) return { snapshot: (await getSnapshot(userId, project.id, Number(r.id)))!, joined: true };
      await new Promise((res) => setTimeout(res, 500));
    }
  }
  const id = Number(created.id);

  const results: SerpResult[] = [];
  let features: string[] = [];
  let requests = 0;
  let error: string | null = null;
  let refused = false;
  const pages = maxRequests(input.engine, input.depth);
  const seen = new Set<string>();
  for (let page = 1; page <= pages; page++) {
    let body: Record<string, unknown>;
    try {
      body = demo ? demoPage(input, page, tracked) : await search!(requestParams(input, page));
      if (!demo) requests++;
    } catch (e) {
      if (!(e instanceof SerpRefused)) requests++; // sent (or possibly sent): counted
      else refused = page === 1;
      error = e instanceof Error ? e.message : String(e);
      break;
    }
    if (page === 1) features = pageFeatures(body);
    const items = pageResults(input.engine, body);
    for (const r of items) {
      if (results.length >= input.depth) break;
      const k = r.url.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      results.push({ ...r, position: results.length + 1 });
    }
    const found = tracked ? results.some((r) => belongsTo(r.domain, tracked)) : false;
    if (!items.length || results.length >= input.depth || !hasNextPage(body) || (input.stopOnFound && found)) break;
  }
  const hit = tracked ? results.find((r) => belongsTo(r.domain, tracked)) : undefined;
  const status = error ? (results.length ? "partial" : "failed") : "done";
  await db
    .prepare(
      `UPDATE serp_snapshots SET status = ?, finished_at = ?, error = ?, requests = ?, scanned = ?, tracked_position = ?, tracked_url = ?, results = ?::jsonb, features = ?::jsonb
        WHERE id = ?`,
    )
    .run(status, Date.now(), error, requests, results.length, hit?.position ?? null, hit?.url ?? null, JSON.stringify(results), JSON.stringify(features), id);
  if (refused) {
    // Nothing was sent: don't keep an empty failed snapshot in the history.
    await db.prepare("DELETE FROM serp_snapshots WHERE id = ?").run(id);
    throw new RunRefused(error!);
  }
  return { snapshot: (await getSnapshot(userId, project.id, id))! };
}

// --- Demo -------------------------------------------------------------------------------------------------

const DEMO_DOMAINS = ["tripadvisor.com", "booking.com", "agoda.com", "expedia.com", "lonelyplanet.com", "hotels.com", "reddit.com", "traveloka.com", "kayak.com", "trip.com"];

function demoPage(input: SerpInput, page: number, tracked: string | null): Record<string, unknown> {
  let h = 2166136261;
  for (const ch of `${input.engine}|${input.params.query}|${page}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const r = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 1000) / 1000;
  const ownAt = Math.floor(r() * 14);
  const organic = Array.from({ length: 10 }, (_, i) => {
    const pos = (page - 1) * 10 + i;
    const own = tracked && pos === ownAt;
    const domain = own ? tracked : DEMO_DOMAINS[Math.floor(r() * DEMO_DOMAINS.length)];
    const slug = input.params.query.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return {
      position: i + 1,
      title: `${input.params.query} – ${own ? "Official site" : domain.split(".")[0]} (demo)`,
      link: `https://www.${domain}/${slug}-${pos + 1}`,
      displayed_link: `www.${domain} › ${slug}`,
      snippet: "Demo result: invented for illustration, not a real search result.",
    };
  });
  const body: Record<string, unknown> = { serpapi_pagination: page < 5 ? { next: "demo" } : undefined };
  if (input.engine === "naver") body.web_results = organic;
  else body.organic_results = organic;
  if (page === 1) {
    body.related_questions = [{}];
    if (input.engine === "google") body.ai_overview = { text_blocks: [] };
  }
  return body;
}
