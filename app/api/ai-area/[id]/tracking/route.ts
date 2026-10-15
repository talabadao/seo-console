import { NextRequest, NextResponse } from "next/server";
import { errorResponse, guard, type Ctx } from "@/lib/ai-area/api";
import { readConfig, readHistories, writeConfig } from "@/lib/ai-area/tracking/store";
import { estimateTracking } from "@/lib/ai-area/tracking/job";
import { latestRuns } from "@/lib/ai-area/runs";
import { RESULT_DEPTHS, type ResultDepth, type TrackedCompetitor, type TrackedKeyword, type TrackingConfig } from "@/lib/ai-area/tracking/types";

/** Config, history (since=YYYY-MM-DD) and recent runs for the project's Google Search Tracking. Read-only. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  try {
    const since = req.nextUrl.searchParams.get("since");
    const config = await readConfig(g.project);
    const histories = await readHistories(g.project.id, config, since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : null);
    const runs = await latestRuns(g.project.id, "tracking", 10);
    return NextResponse.json({ config, histories, runs, estimate: estimateTracking(config) });
  } catch (e) {
    return errorResponse(e);
  }
}

function isValidDevice(v: unknown): v is TrackingConfig["settings"]["device"] {
  return v === "desktop" || v === "tablet" || v === "mobile";
}

/** Saves the tracking config (validation adapted from the donor's config route). */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  const input = (await req.json().catch(() => null)) as Partial<TrackingConfig> | null;
  if (!input) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  try {
    const current = await readConfig(g.project);
    const settings = input.settings
      ? {
          language: String(input.settings.language || current.settings.language).trim().slice(0, 10) || "en",
          country: String(input.settings.country || current.settings.country).trim().slice(0, 10) || "us",
          device: isValidDevice(input.settings.device) ? input.settings.device : current.settings.device,
          resultDepth: RESULT_DEPTHS.includes(Number(input.settings.resultDepth) as ResultDepth)
            ? (Number(input.settings.resultDepth) as ResultDepth)
            : current.settings.resultDepth,
        }
      : current.settings;
    const brand = input.brand
      ? {
          name: String(input.brand.name ?? current.brand.name).trim().slice(0, 200),
          aliases: Array.isArray(input.brand.aliases) ? input.brand.aliases.map((a) => String(a).trim()).filter(Boolean).slice(0, 50) : current.brand.aliases,
          website: String(input.brand.website ?? current.brand.website).trim().slice(0, 200),
        }
      : current.brand;
    const keywords: TrackedKeyword[] = Array.isArray(input.keywords)
      ? input.keywords
          .map((k) => ({
            id: String(k?.id || crypto.randomUUID()),
            keyword: String(k?.keyword ?? "").trim().slice(0, 300),
            active: k?.active !== false,
            createdAt: String(k?.createdAt || new Date().toISOString()),
          }))
          .filter((k) => k.keyword)
          .slice(0, 500)
      : current.keywords;
    const competitors: TrackedCompetitor[] = Array.isArray(input.competitors)
      ? input.competitors
          .map((c) => ({
            id: String(c?.id || crypto.randomUUID()),
            name: String(c?.name ?? "").trim().slice(0, 200),
            aliases: Array.isArray(c?.aliases) ? c.aliases.map((a) => String(a).trim()).filter(Boolean).slice(0, 50) : [],
            website: String(c?.website ?? "").trim().slice(0, 200),
          }))
          .slice(0, 50)
      : current.competitors;
    const excludedDomains = Array.isArray(input.excludedDomains)
      ? Array.from(new Set(input.excludedDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean))).slice(0, 500)
      : current.excludedDomains;
    const next: TrackingConfig = { settings, brand, keywords, competitors, excludedDomains };
    await writeConfig(g.project.id, next);
    return NextResponse.json(next);
  } catch (e) {
    return errorResponse(e);
  }
}
