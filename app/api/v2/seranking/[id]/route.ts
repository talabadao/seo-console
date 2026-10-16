import { NextRequest, NextResponse, after } from "next/server";
import { currentUser } from "@/lib/session";
import { getProject } from "@/lib/projects";
import { isDemoWebsite, demoSeRawReport } from "@/lib/v2/summary/demo";
import { SeRankingError } from "@/lib/seranking/client";
import { seRankingConfigured } from "@/lib/seranking/rankings";
import { viewReport, type SeRawReport } from "@/lib/seranking/report";
import { readThrough, setBackgroundRunner, syncReady } from "@/lib/sync/cache";
import { kindOf } from "@/lib/sync/cache";
import { projectConfigVersion, type SeReportPayload, type SeReportQuery } from "@/lib/sync/kinds";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const RANGE_DAYS = [7, 28, 90] as const;
const COMPARE_DAYS = [1, 7, 28, 90] as const;

const SOURCE = "SE Ranking";

/**
 * Rank tracking → SE Ranking for one project. Read-only; served from the shared cache (one refresh at most every
 * 12 hours, or on an explicit refresh after a 5-minute cooldown). The engine and keyword group are views of the
 * saved report, so changing them never asks SE Ranking again.
  *   ?days=7|28|90&compare=1|7|28|90&engine=<site engine id>&group=<keyword group id>&refresh=1
 * States: demo · unconfigured · not-mapped · no-data · unauthorized · pending · error · live (fresh or stale).
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await ctx.params).id);
  const project = Number.isSafeInteger(id) ? await getProject(user.id, id) : null;
  if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });

  const q = req.nextUrl.searchParams;
  const days = RANGE_DAYS.find((d) => d === Number(q.get("days"))) ?? 28;
  const compareDays = COMPARE_DAYS.find((d) => d === Number(q.get("compare")) && d <= days) ?? days;
  const engineId = q.get("engine") ? Number(q.get("engine")) : null;
  const group = q.get("group") || null;
  const view = (raw: SeRawReport) => viewReport(raw, { engineId, group, compareDays });

  if (isDemoWebsite(project.websiteUrl)) {
    return NextResponse.json({ state: "demo", source: SOURCE, message: "Demo data: invented for illustration, not a measurement.", view: view(demoSeRawReport(id, days)) });
  }
  if (!seRankingConfigured()) {
    return NextResponse.json({ state: "unconfigured", source: SOURCE, message: "SE Ranking isn't connected to SEO Console (no SE Ranking API key on the server)." });
  }

  const settle = (payload: SeReportPayload, cache?: Record<string, unknown>) => {
    if (payload.status === "not-mapped") {
      return NextResponse.json({
        state: "not-mapped",
        source: SOURCE,
        chosenMissing: payload.chosenMissing,
        message: payload.chosenMissing
          ? "The SE Ranking project chosen for this project is no longer in the SE Ranking account."
          : "No SE Ranking project tracks this website. Choose one in Project settings → Integrations.",
        cache,
      });
    }
    if (payload.status === "no-data") return NextResponse.json({ state: "no-data", source: SOURCE, message: payload.message, site: payload.site, cache });
    try {
      return NextResponse.json({ state: "live", source: SOURCE, view: view(payload.raw), cache });
    } catch (e) {
      // The chosen group or engine has no checks in this range.
      return NextResponse.json({ state: "no-data", source: SOURCE, message: e instanceof Error ? e.message : String(e), site: payload.raw.site, cache });
    }
  };

  if (await syncReady()) {
    setBackgroundRunner((fn) => after(fn));
    const query: SeReportQuery = { projectId: id, days, config: await projectConfigVersion(user, project) };
    const r = await readThrough<SeReportQuery, SeReportPayload>({ kind: "seranking:report", userId: user.id, projectId: id, query, waitMs: 20_000, force: q.get("refresh") === "1" });
    if (r.payload) {
      return settle(r.payload, {
        state: r.state === "stale" ? "stale" : "fresh",
        fetchedAt: r.fetchedAt ?? null,
        dataThrough: r.dataThrough ?? null,
        refreshing: Boolean(r.refreshing),
        lastError: r.error ?? null,
        cooldown: r.cooldown,
      });
    }
    if (r.state === "pending") return NextResponse.json({ state: "pending", source: SOURCE, message: "Fetching from SE Ranking for the first time…" });
    if (r.error && /\b(401|403)\b|forbidden|unauthori[sz]ed|invalid.*(key|token)/i.test(r.error)) {
      return NextResponse.json({ state: "unauthorized", source: SOURCE, message: `SE Ranking refused the server's API key: ${r.error}` });
    }
    return NextResponse.json({ state: "error", source: SOURCE, message: r.error ?? "The refresh failed." });
  }

  // Before migration 0008: one direct read.
  try {
    const kind = kindOf("seranking:report")!;
    const { payload } = (await kind.run({ userId: user.id, projectId: id, query: { projectId: id, days, config: "" } })) as { payload: SeReportPayload };
    return settle(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof SeRankingError && (e.status === 401 || e.status === 403)) return NextResponse.json({ state: "unauthorized", source: SOURCE, message });
    return NextResponse.json({ state: "error", source: SOURCE, message });
  }
}
