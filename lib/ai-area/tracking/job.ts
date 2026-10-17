// Google Search Tracking runs: estimate, lock, run in time-boxed chunks, record what was used.
//
// - The estimate is shown before a run starts (SerpApi requests per keyword: one per 10-result page, plus the
//   AI Overview when Google shows one, plus AI Mode, plus a possible page-1 retry when Google's results look
//   unrelated).
// - One running tracking run per project (lib/ai-area/runs.ts). Keywords run one at a time so a cap stops
//   exactly at its limit; each chunk stops after CHUNK_MS and the page asks for the next chunk.
// - Every request goes through serpSearch (policy, allowance, ledger). When a cap or the Preview policy refuses
//   a request, the run stops; results already fetched are kept.

import type { UserRow } from "@/lib/session";
import type { Project } from "@/lib/projects";
import { NO_SERP_KEY, SerpRefused, serpKey, serpSearch } from "@/lib/providers/serpapi";
import { claimRun, finishRun, getRun, progressRun, releaseRun, startRun } from "@/lib/ai-area/runs";
import { readConfig, readHistory, writeHistory } from "./store";
import { todayDateString, trackKeyword } from "./run";
import type { TrackingConfig } from "./types";

const CHUNK_MS = 200_000;

export interface TrackingEstimate {
  keywords: number;
  depth: number;
  /** Requests per keyword: fewest (no AI Overview), typical, most (retry + AI Overview). */
  perKeyword: { min: number; typical: number; max: number };
  total: { min: number; typical: number; max: number };
}

export interface TrackingActual {
  plan: string[];
  done: string[];
  searchesSent: number;
  failedKeywords: number;
  stoppedReason?: string;
}

export function estimateTracking(config: TrackingConfig, keywordIds?: string[]): TrackingEstimate {
  const active = config.keywords.filter((k) => k.active && (!keywordIds || keywordIds.includes(k.id)));
  const pages = Math.max(1, Math.ceil((config.settings.resultDepth ?? 10) / 10));
  const perKeyword = { min: pages + 1, typical: pages + 2, max: pages + 3 };
  return {
    keywords: active.length,
    depth: config.settings.resultDepth,
    perKeyword,
    total: { min: perKeyword.min * active.length, typical: perKeyword.typical * active.length, max: perKeyword.max * active.length },
  };
}

export async function beginTracking(user: UserRow, project: Project, keywordIds?: string[]): Promise<{ runId: string; estimate: TrackingEstimate }> {
  const config = await readConfig(project);
  const estimate = estimateTracking(config, keywordIds);
  if (!estimate.keywords) throw new Error("No active keywords to track. Add keywords in Settings.");
  const runId = await startRun(user.id, project.id, "tracking", "manual", estimate);
  const plan = config.keywords.filter((k) => k.active && (!keywordIds || keywordIds.includes(k.id))).map((k) => k.id);
  await progressRun(runId, { plan, done: [], searchesSent: 0, failedKeywords: 0 } satisfies TrackingActual);
  return { runId, estimate };
}

/** Runs the next chunk of keywords. Returns the run's progress; `finished` when nothing is left. */
export async function continueTracking(user: UserRow, project: Project, runId: string): Promise<{ finished: boolean; actual: TrackingActual; status: string; error: string | null }> {
  const run = await getRun<TrackingEstimate, TrackingActual>(project.id, runId);
  if (!run) throw new Error("Unknown run.");
  if (run.status !== "running") return { finished: true, actual: run.actual!, status: run.status, error: run.error };
  const actual: TrackingActual = run.actual ?? { plan: [], done: [], searchesSent: 0, failedKeywords: 0 };
  if (!(await claimRun(runId, CHUNK_MS + 60_000))) return { finished: false, actual, status: "busy", error: null };
  try {
    // Re-read after claiming: another request may have finished a chunk in between.
    const fresh = await getRun<TrackingEstimate, TrackingActual>(project.id, runId);
    if (!fresh || fresh.status !== "running") return { finished: true, actual: fresh?.actual ?? actual, status: fresh?.status ?? "error", error: fresh?.error ?? null };
    return await runChunk(user, project, runId, fresh.actual ?? actual);
  } finally {
    await releaseRun(runId);
  }
}

async function runChunk(user: UserRow, project: Project, runId: string, actual: TrackingActual): Promise<{ finished: boolean; actual: TrackingActual; status: string; error: string | null }> {
  const key = await serpKey(user.id, project.id);
  if (!key) {
    await finishRun(runId, "error", actual, NO_SERP_KEY);
    return { finished: true, actual, status: "error", error: "No SerpApi key." };
  }
  const config = await readConfig(project);
  const search = (params: Record<string, string>) => serpSearch(params, { userId: user.id, projectId: project.id, runId, key });
  const started = Date.now();
  const date = todayDateString();

  for (const id of actual.plan) {
    if (actual.done.includes(id)) continue;
    if (Date.now() - started > CHUNK_MS) break;
    const kw = config.keywords.find((k) => k.id === id);
    if (!kw) {
      actual.done.push(id);
      continue;
    }
    try {
      const snapshot = await trackKeyword(kw, config.settings, config.brand, search);
      const history = (await readHistory(project.id, kw.id)) ?? { keywordId: kw.id, keyword: kw.keyword, days: [] };
      history.days = [...history.days.filter((d) => d.date !== date), snapshot].sort((a, b) => a.date.localeCompare(b.date));
      history.keyword = kw.keyword;
      await writeHistory(project.id, history);
      actual.searchesSent += snapshot.searchesUsed;
      actual.done.push(id);
      if (snapshot.error && !snapshot.stopped) actual.failedKeywords++;
      if (snapshot.stopped) {
        actual.stoppedReason = snapshot.error ?? "Stopped by a cap.";
        await finishRun(runId, "stopped", actual, actual.stoppedReason);
        return { finished: true, actual, status: "stopped", error: actual.stoppedReason };
      }
    } catch (e) {
      if (e instanceof SerpRefused) {
        actual.stoppedReason = e.message;
        await finishRun(runId, "stopped", actual, e.message);
        return { finished: true, actual, status: "stopped", error: e.message };
      }
      await finishRun(runId, "error", actual, e instanceof Error ? e.message : String(e));
      throw e;
    }
    await progressRun(runId, actual);
  }

  if (actual.plan.every((id) => actual.done.includes(id))) {
    await finishRun(runId, "done", actual);
    return { finished: true, actual, status: "done", error: null };
  }
  await progressRun(runId, actual);
  return { finished: false, actual, status: "running", error: null };
}
