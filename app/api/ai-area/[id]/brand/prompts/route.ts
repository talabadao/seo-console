import { NextRequest, NextResponse } from "next/server";
import { errorResponse, guard, type Ctx } from "@/lib/ai-area/api";
import { brandTerms } from "@/lib/ai-area/brand/analyze";
import { MAX_PROMPTS, readPrompts, writePrompts } from "@/lib/ai-area/brand/store";
import type { BrandPrompt, PromptSource } from "@/lib/ai-area/brand/types";
import { countMentionsAny } from "@/lib/ai-area/mentions";
import { readConfig } from "@/lib/ai-area/tracking/store";

// Prompt list for Brand Mentions (adapted from the donor's /api/brand/prompts). Storage only; no paid calls.

const SOURCES: PromptSource[] = ["manual", "upload", "suggested"];
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const idList = (v: unknown) => new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function GET(_req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  try {
    return NextResponse.json({ prompts: await readPrompts(g.project.id), max: MAX_PROMPTS });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Adds prompts (typed, uploaded or picked from suggestions); duplicates of existing prompts are skipped. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx, { manage: true });
  if ("error" in g) return g.error;
  const body = (await req.json().catch(() => null)) as { prompts?: unknown; source?: unknown } | null;
  try {
    const source = SOURCES.includes(body?.source as PromptSource) ? (body?.source as PromptSource) : "manual";
    const [existing, config] = await Promise.all([readPrompts(g.project.id), readConfig(g.project)]);
    const terms = brandTerms(config.brand);
    const seen = new Set(existing.map((p) => p.text.toLowerCase()));
    const added: BrandPrompt[] = [];
    for (const raw of Array.isArray(body?.prompts) ? body.prompts.slice(0, MAX_PROMPTS) : []) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const text = clean(typeof raw === "string" ? raw : r.text, 400);
      if (text.length < 3 || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      added.push({
        id: crypto.randomUUID(),
        text,
        topic: clean(r.topic, 40) || "General",
        branded: terms.length > 0 && countMentionsAny(text, terms) > 0,
        source,
        active: true,
        createdAt: new Date().toISOString(),
      });
    }
    const kept = added.slice(0, Math.max(0, MAX_PROMPTS - existing.length));
    await writePrompts(g.project.id, [...existing, ...kept]);
    return NextResponse.json({ added: kept.length, skipped: added.length - kept.length, prompts: await readPrompts(g.project.id) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Edits prompts: { ids, active?, topic? } or { id, text }. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx, { manage: true });
  if ("error" in g) return g.error;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const ids = typeof body?.id === "string" ? new Set([body.id]) : idList(body?.ids);
    const [prompts, config] = await Promise.all([readPrompts(g.project.id), readConfig(g.project)]);
    const terms = brandTerms(config.brand);
    const next = prompts.map((p) => {
      if (!ids.has(p.id)) return p;
      const text = clean(body?.text, 400) || p.text;
      return {
        ...p,
        text,
        branded: terms.length > 0 && countMentionsAny(text, terms) > 0,
        active: typeof body?.active === "boolean" ? body.active : p.active,
        topic: clean(body?.topic, 40) || p.topic,
      };
    });
    await writePrompts(g.project.id, next);
    return NextResponse.json({ prompts: next });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await guard(ctx, { manage: true });
  if ("error" in g) return g.error;
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  try {
    const ids = idList(body?.ids);
    const next = (await readPrompts(g.project.id)).filter((p) => !ids.has(p.id));
    await writePrompts(g.project.id, next);
    return NextResponse.json({ prompts: next });
  } catch (e) {
    return errorResponse(e);
  }
}
