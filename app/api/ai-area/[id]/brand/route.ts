import { NextRequest, NextResponse } from "next/server";
import { errorResponse, guard, type Ctx } from "@/lib/ai-area/api";
import { buildDashboard, type DashboardFilters } from "@/lib/ai-area/brand/dashboard";
import { costReport } from "@/lib/ai-area/brand/costs";
import { previewBrandRun } from "@/lib/ai-area/brand/run";
import { listCycles, readCycle, readFacts, readPrompts, readSettings, writeSettings } from "@/lib/ai-area/brand/store";
import { CHATGPT_MODELS, CLAUDE_MODELS } from "@/lib/ai-area/brand/pricing";
import { PLATFORMS, type BrandSettings, type Cycle, type Platform } from "@/lib/ai-area/brand/types";
import { readConfig } from "@/lib/ai-area/tracking/store";
import { latestRuns } from "@/lib/ai-area/runs";
import { serpKey } from "@/lib/providers/serpapi";

const RANGES: Record<string, number | null> = { "30": 30, "90": 90, "180": 180, "365": 365, all: null };

/** Everything the Brand Mentions screens show for the chosen range and filters, read from storage (no paid calls). */
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  try {
    const p = req.nextUrl.searchParams;
    const filters: DashboardFilters = {
      platform: PLATFORMS.includes(p.get("platform") as Platform) ? (p.get("platform") as Platform) : "all",
      promptType: p.get("type") === "branded" || p.get("type") === "unbranded" ? (p.get("type") as "branded" | "unbranded") : "all",
      topic: p.get("topic") || "all",
    };
    const range = p.get("range") ?? "90";
    const days = range in RANGES ? RANGES[range] : 90;
    const since = days ? new Date(Date.now() - days * 86_400_000).toISOString() : null;

    const [summaries, config, settings, prompts, verdicts, key] = await Promise.all([
      listCycles(g.project.id),
      readConfig(g.project),
      readSettings(g.project.id),
      readPrompts(g.project.id),
      readFacts(g.project.id),
      serpKey(g.user.id, g.project.id),
    ]);
    const inRange = summaries.filter((c) => !since || c.startedAt >= since).slice(-26);
    const cycles = (await Promise.all(inRange.map((c) => readCycle(g.project.id, c.id)))).filter((c): c is Cycle => c !== null);
    const dashboard = buildDashboard(inRange, cycles, config, filters, verdicts);
    const costs = await costReport({ userId: g.user.id, projectId: g.project.id, hasSerpKey: Boolean(key) }, settings, prompts.filter((x) => x.active).length);
    return NextResponse.json(
      {
        dashboard,
        settings,
        costs,
        brand: config.brand,
        competitors: config.competitors.map((c) => ({ name: c.name, website: c.website })),
        allCycles: summaries.map(({ id, startedAt, status, done, total, costUsd, serpCredits, note, finishedAt }) => ({ id, startedAt, status, done, total, costUsd, serpCredits, note, finishedAt })),
        estimate: await previewBrandRun(g.user, g.project),
        runs: await latestRuns(g.project.id, "brand", 10),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

/** Saves Brand Mentions settings: platforms and models. The daily spending limit is a server setting, not editable here. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx, { manage: true });
  if ("error" in g) return g.error;
  const body = (await req.json().catch(() => null)) as Partial<BrandSettings> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  try {
    const current = await readSettings(g.project.id);
    const next: BrandSettings = {
      platforms: Object.fromEntries(PLATFORMS.map((p) => [p, typeof body.platforms?.[p] === "boolean" ? body.platforms[p] : current.platforms[p]])) as BrandSettings["platforms"],
      chatgptModel: CHATGPT_MODELS.some((m) => m.id === body.chatgptModel) ? (body.chatgptModel as string) : current.chatgptModel,
      claudeModel: CLAUDE_MODELS.some((m) => m.id === body.claudeModel) ? (body.claudeModel as string) : current.claudeModel,
    };
    await writeSettings(g.project.id, next);
    return NextResponse.json({ settings: next });
  } catch (e) {
    return errorResponse(e);
  }
}
