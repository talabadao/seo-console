// Brand Mentions runs, adapted from the AI Brand Mention app. A cycle asks every active prompt on every enabled,
// available platform once, analyses each answer and writes the perception summaries.
//
// - One running brand run per project (ai_runs, partial unique index), and one request working on it at a time
//   (claimRun lease), so two tabs can't double-send. Each request runs a time-boxed chunk; the page asks for the
//   next one until the run finishes.
// - SerpApi requests (AI Mode, AI Overview) go through serpSearch (policy, project cap, ledger); model calls
//   (ChatGPT, Claude, analysis, summaries) go through meteredCall (policy, daily limit, ledger).
// - A SerpApi cap or policy refusal stops the run ("stopped"); the daily model limit pauses it ("paused-budget").
//   Answers already collected are kept, and a later Run continues the same cycle.
// - When the analysis model can't be called (e.g. Preview, where paid model calls are off) answers are still
//   stored with the reason; nothing is filled in with placeholder results.
// - No scheduled runs in this phase: runs start from the page only.

import type { UserRow } from "@/lib/session";
import type { Project } from "@/lib/projects";
import { deploymentOf } from "@/lib/environment";
import { LlmRefused, type LlmMeter } from "@/lib/providers/llm";
import { SerpRefused, serpKey, serpSearch } from "@/lib/providers/serpapi";
import { claimRun, finishRun, getRun, progressRun, releaseRun, startRun } from "@/lib/ai-area/runs";
import { readConfig } from "../tracking/store";
import type { TrackingConfig } from "../tracking/types";
import { analyzeResponse, summarizePerception } from "./analyze";
import { updateCustomerGap } from "./gap";
import { ANALYSIS_MODEL, CHATGPT_MODELS, CLAUDE_MODELS, SERP_CREDITS, analysisCost, typicalAnswerCost } from "./pricing";
import { askAiMode, askAiOverview, askChatGpt, askClaude, platformUnavailable, type Answer } from "./providers";
import { listCycles, readCycle, readPrompts, readSettings, updateCycleSummary, writeCycle, writeCycles } from "./store";
import { PLATFORMS, PLATFORM_LABEL, type BrandResponse, type BrandSettings, type Cycle, type CycleSummary, type Platform } from "./types";

const CHUNK_MS = 200_000;

export interface BrandEstimate {
  prompts: number;
  platforms: Platform[];
  answers: number;
  /** SerpApi requests: AI Mode is one, AI Overview one or two. */
  serpRequests: { min: number; max: number };
  /** Estimated model spend for the answers and their analysis (USD), before the summaries. */
  modelUsd: number;
  unavailable: Partial<Record<Platform, string>>;
}

export interface BrandActual {
  cycleId: string;
  answered: number;
  serpRequests: number;
  costUsd: number;
  stoppedReason?: string;
}

export interface BrandStep {
  finished: boolean;
  status: string;
  error: string | null;
  actual: BrandActual;
  cycle: CycleSummary | null;
}

function availability(user: UserRow, project: Project, hasSerpKey: boolean, settings: BrandSettings) {
  const unavailable: Partial<Record<Platform, string>> = {};
  const usable: Platform[] = [];
  for (const p of PLATFORMS.filter((x) => settings.platforms[x])) {
    const why = platformUnavailable(p, { userId: user.id, projectId: project.id, hasSerpKey });
    if (why) unavailable[p] = why;
    else usable.push(p);
  }
  return { usable, unavailable };
}

export function estimateBrand(settings: BrandSettings, prompts: number, platforms: Platform[], unavailable: Partial<Record<Platform, string>>): BrandEstimate {
  const chatgpt = CHATGPT_MODELS.find((m) => m.id === settings.chatgptModel) ?? CHATGPT_MODELS[0];
  const claude = CLAUDE_MODELS.find((m) => m.id === settings.claudeModel) ?? CLAUDE_MODELS[0];
  const analysis = analysisCost(ANALYSIS_MODEL);
  const per = (p: Platform) => (p === "chatgpt" ? typicalAnswerCost(chatgpt) : p === "claude" ? typicalAnswerCost(claude) : 0) + analysis;
  return {
    prompts,
    platforms,
    answers: prompts * platforms.length,
    serpRequests: {
      min: prompts * platforms.filter((p) => SERP_CREDITS[p] > 0).length,
      max: prompts * platforms.reduce((s, p) => s + SERP_CREDITS[p], 0),
    },
    modelUsd: prompts * platforms.reduce((s, p) => s + per(p), 0),
    unavailable,
  };
}

/** What a Run now would do, for the confirmation dialog. Continuing an unfinished cycle covers only what's left. */
export async function previewBrandRun(user: UserRow, project: Project): Promise<BrandEstimate & { continues: string | null }> {
  const [prompts, settings, key, cycles] = await Promise.all([readPrompts(project.id), readSettings(project.id), serpKey(project.id), listCycles(project.id)]);
  const { usable, unavailable } = availability(user, project, Boolean(key), settings);
  const open = [...cycles].reverse().find((c) => c.status !== "done");
  if (open) {
    const cycle = await readCycle(project.id, open.id);
    if (cycle) {
      const done = new Set(cycle.responses.map((r) => `${r.promptId}:${r.platform}`));
      const left = cycle.plan.filter((t) => !done.has(`${t.promptId}:${t.platform}`) && usable.includes(t.platform));
      const est = estimateBrand(settings, 0, [], unavailable);
      for (const t of left) {
        const one = estimateBrand(settings, 1, [t.platform], {});
        est.answers++;
        est.serpRequests.min += one.serpRequests.min;
        est.serpRequests.max += one.serpRequests.max;
        est.modelUsd += one.modelUsd;
      }
      est.prompts = new Set(left.map((t) => t.promptId)).size;
      est.platforms = usable.filter((p) => left.some((t) => t.platform === p));
      return { ...est, continues: open.id };
    }
  }
  return { ...estimateBrand(settings, prompts.filter((p) => p.active).length, usable, unavailable), continues: null };
}

function newCycleId(): string {
  return `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 6)}`;
}

/** Starts a run: continues the unfinished cycle, or starts a new one with every active prompt on every usable platform. */
export async function beginBrandRun(user: UserRow, project: Project): Promise<{ runId: string; cycleId: string; estimate: BrandEstimate & { continues: string | null } }> {
  const estimate = await previewBrandRun(user, project);
  if (!estimate.answers) {
    const reasons = Object.entries(estimate.unavailable).map(([p, why]) => `${PLATFORM_LABEL[p as Platform]}: ${why}`);
    throw new Error(reasons.length ? `Nothing can run right now. ${reasons.join(" ")}` : "Add at least one active prompt and enable a platform first.");
  }
  const runId = await startRun(user.id, project.id, "brand", "manual", estimate);
  let cycleId = estimate.continues;
  if (cycleId) {
    await updateCycleSummary(project.id, cycleId, { status: "running", runId, note: undefined });
  } else {
    const prompts = (await readPrompts(project.id)).filter((p) => p.active);
    cycleId = newCycleId();
    const cycle: Cycle = {
      id: cycleId,
      plan: prompts.flatMap((p) => estimate.platforms.map((platform) => ({ promptId: p.id, platform }))),
      prompts: Object.fromEntries(prompts.map((p) => [p.id, { text: p.text, topic: p.topic, branded: p.branded }])),
      responses: [],
      summaries: {},
      attributes: [],
    };
    // Carry the attribute names forward so attributes stay comparable from cycle to cycle.
    const cycles = await listCycles(project.id);
    const previous = cycles.at(-1);
    if (previous) cycle.attributes = (await readCycle(project.id, previous.id))?.attributes ?? [];
    await writeCycle(project.id, cycle);
    const summary: CycleSummary = { id: cycleId, startedAt: new Date().toISOString(), status: "running", total: cycle.plan.length, done: 0, costUsd: 0, serpCredits: 0, trigger: "manual", runId };
    await writeCycles(project.id, [...cycles, summary]);
  }
  await progressRun(runId, { cycleId, answered: 0, serpRequests: 0, costUsd: 0 } satisfies BrandActual);
  return { runId, cycleId, estimate };
}

export async function continueBrandRun(user: UserRow, project: Project, runId: string): Promise<BrandStep> {
  const run = await getRun<BrandEstimate, BrandActual>(project.id, runId);
  if (!run || run.kind !== "brand") throw new Error("Unknown run.");
  const summaryOf = async (id: string) => (await listCycles(project.id)).find((c) => c.id === id) ?? null;
  const actual = run.actual ?? { cycleId: "", answered: 0, serpRequests: 0, costUsd: 0 };
  if (run.status !== "running") return { finished: true, status: run.status, error: run.error, actual, cycle: await summaryOf(actual.cycleId) };
  if (!(await claimRun(runId, CHUNK_MS + 60_000))) return { finished: false, status: "busy", error: null, actual, cycle: await summaryOf(actual.cycleId) };
  try {
    const fresh = await getRun<BrandEstimate, BrandActual>(project.id, runId);
    if (!fresh || fresh.status !== "running") {
      const a = fresh?.actual ?? actual;
      return { finished: true, status: fresh?.status ?? "error", error: fresh?.error ?? null, actual: a, cycle: await summaryOf(a.cycleId) };
    }
    return await runChunk(user, project, runId, fresh.actual ?? actual);
  } finally {
    await releaseRun(runId);
  }
}

async function answer(platform: Platform, prompt: string, config: TrackingConfig, settings: BrandSettings, search: Parameters<typeof askAiMode>[2], meter: LlmMeter): Promise<Answer> {
  switch (platform) {
    case "aiMode":
      return askAiMode(prompt, config.settings, search);
    case "aiOverview":
      return askAiOverview(prompt, config.settings, search);
    case "chatgpt":
      return askChatGpt(prompt, config.settings, settings.chatgptModel, meter);
    case "claude":
      return askClaude(prompt, config.settings, settings.claudeModel, meter);
  }
}

async function runChunk(user: UserRow, project: Project, runId: string, actual: BrandActual): Promise<BrandStep> {
  const cycle = await readCycle(project.id, actual.cycleId);
  if (!cycle) {
    await finishRun(runId, "error", actual, "The run's cycle is missing.");
    return { finished: true, status: "error", error: "The run's cycle is missing.", actual, cycle: null };
  }
  const [config, settings, key] = await Promise.all([readConfig(project), readSettings(project.id), serpKey(project.id)]);
  const meter: LlmMeter = { userId: user.id, projectId: project.id, runId };
  const started = Date.now();
  // One at a time on Preview, where the SerpApi allowance is tiny, so the cap stops at an exact answer.
  const concurrency = deploymentOf() === "preview" ? 1 : 4;
  let stop: { status: "stopped" | "paused-budget"; reason: string } | null = null;

  const done = new Set(cycle.responses.map((r) => `${r.promptId}:${r.platform}`));
  const pending = cycle.plan.filter((t) => !done.has(`${t.promptId}:${t.platform}`));
  let next = 0;
  let unsaved = 0;
  const save = async () => {
    unsaved = 0;
    await writeCycle(project.id, cycle);
    await updateCycleSummary(project.id, cycle.id, {
      done: cycle.responses.length,
      costUsd: cycle.responses.reduce((s, r) => s + r.costUsd, 0),
      serpCredits: cycle.responses.reduce((s, r) => s + r.serpCredits, 0),
    });
    await progressRun(runId, actual);
  };

  const worker = async () => {
    while (next < pending.length && !stop && Date.now() - started < CHUNK_MS) {
      const task = pending[next++];
      const prompt = cycle.prompts[task.promptId];
      if (!prompt) continue;
      const response: BrandResponse = { promptId: task.promptId, platform: task.platform, at: new Date().toISOString(), present: false, text: "", sources: [], costUsd: 0, serpCredits: 0 };
      // Counts the SerpApi requests this answer actually sent (including a refused second AI Overview request's first one).
      let sent = 0;
      const search = async (params: Record<string, string>) => {
        if (!key) throw new SerpRefused("No SerpApi key: add one in Project settings or set SERPAPI_API_KEY on the server.");
        const out = serpSearch(params, { userId: user.id, projectId: project.id, runId, key });
        sent++;
        try {
          return await out;
        } catch (e) {
          // Refused before sending: not a request.
          if (e instanceof SerpRefused) sent--;
          throw e;
        }
      };
      try {
        const a = await answer(task.platform, prompt.text, config, settings, search, meter);
        Object.assign(response, { present: a.present, text: a.text, sources: a.sources, costUsd: a.costUsd, model: a.model });
      } catch (e) {
        response.serpCredits = sent;
        actual.serpRequests += sent;
        if (e instanceof SerpRefused) {
          stop = { status: "stopped", reason: e.message };
          // Keep an answer that cost a request but couldn't finish; drop one that sent nothing, so a later run retries it.
          if (sent > 0) {
            response.error = e.message.slice(0, 300);
            cycle.responses.push(response);
          }
          continue;
        }
        if (e instanceof LlmRefused) {
          stop = { status: e.reason === "cap" ? "paused-budget" : "stopped", reason: e.message };
          continue;
        }
        response.error = (e instanceof Error ? e.message : String(e)).slice(0, 300) || "Failed";
        cycle.responses.push(response);
        actual.answered++;
        if (++unsaved >= 4) await save();
        continue;
      }
      response.serpCredits = sent;
      actual.serpRequests += sent;
      if (response.present) {
        try {
          const { analysis, costUsd } = await analyzeResponse(meter, response, prompt.text, config.brand, config.competitors, cycle.attributes);
          response.analysis = analysis;
          response.costUsd += costUsd;
          for (const name of [...analysis.claims.map((c) => c.attribute), ...analysis.brands.flatMap((b) => b.attributes.map((x) => x.attribute))]) {
            if (name && !cycle.attributes.includes(name) && cycle.attributes.length < 40) cycle.attributes.push(name);
          }
        } catch (e) {
          response.analysisError = (e instanceof Error ? e.message : String(e)).slice(0, 300);
          if (e instanceof LlmRefused && e.reason === "cap") stop = { status: "paused-budget", reason: e.message };
        }
      }
      actual.costUsd += response.costUsd;
      actual.answered++;
      cycle.responses.push(response);
      if (++unsaved >= 4) await save();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, pending.length)) }, worker));
  await save();

  const summary = async () => (await listCycles(project.id)).find((c) => c.id === cycle.id) ?? null;
  if (stop) {
    const s = stop as { status: "stopped" | "paused-budget"; reason: string };
    actual.stoppedReason = s.reason;
    await updateCycleSummary(project.id, cycle.id, { status: s.status, note: s.reason });
    await finishRun(runId, "stopped", actual, s.reason);
    return { finished: true, status: "stopped", error: s.reason, actual, cycle: await summary() };
  }
  if (cycle.responses.length < cycle.plan.length) {
    await progressRun(runId, actual);
    return { finished: false, status: "running", error: null, actual, cycle: await summary() };
  }

  // Every answer is in: perception summaries, then the comparison with customer reviews (both optional).
  let note: string | undefined;
  try {
    actual.costUsd += await buildSummaries(meter, cycle, config, settings);
    await writeCycle(project.id, cycle);
  } catch (e) {
    note = `Perception summary not written: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (!note) await updateCustomerGap(meter, project, config, cycle).catch(() => {});
  await updateCycleSummary(project.id, cycle.id, {
    status: "done",
    finishedAt: new Date().toISOString(),
    note,
    costUsd: cycle.responses.reduce((s, r) => s + r.costUsd, 0),
  });
  await finishRun(runId, "done", actual);
  return { finished: true, status: "done", error: null, actual, cycle: await summary() };
}

/** Perception narratives for the whole cycle and for each platform. Returns the estimated cost. */
export async function buildSummaries(meter: LlmMeter, cycle: Cycle, config: TrackingConfig, settings: BrandSettings): Promise<number> {
  const analysed = cycle.responses.filter((r) => r.analysis);
  if (!analysed.length) throw new Error("no analysed answers in this run.");
  let cost = 0;
  const scopes: Array<Platform | "all"> = ["all", ...PLATFORMS.filter((p) => settings.platforms[p] && cycle.plan.some((t) => t.platform === p))];
  for (const scope of scopes) {
    const claims = analysed
      .filter((r) => (scope === "all" || r.platform === scope) && r.analysis?.brandMentioned)
      .flatMap((r) => (r.analysis?.claims ?? []).map((c) => ({ ...c, platform: r.platform })));
    const { summary, costUsd } = await summarizePerception(meter, config.brand, claims, scope === "all" ? "AI answer engines" : PLATFORM_LABEL[scope]);
    cost += costUsd;
    cycle.summaries[scope] = summary;
  }
  return cost;
}
