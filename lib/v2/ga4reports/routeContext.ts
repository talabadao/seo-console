// Shared checks for the GA4 report routes (app/api/v2/ga4/[id]/…). Server only.
// Order: signed in (401) → the project is this account's (404) → demo project → GA4 linked, scope granted and the
// property still listed for this account → Google token. Only then is anything read or fetched.

import { NextResponse, after } from "next/server";
import { currentUser, type UserRow } from "@/lib/session";
import { getProject, type Project } from "@/lib/projects";
import { checkCompatibility, cleanGaError, propertyNow } from "@/lib/ga4";
import { filterExpression, normalizeSpec, unknownFields, type ReportSpec } from "./spec";
import { isDemoWebsite } from "@/lib/v2/summary/demo";
import { gaContext, gaPreconditions, googleToken } from "@/lib/v2/summary/live";
import { readThrough, setBackgroundRunner, syncReady } from "@/lib/sync/cache";
import { DEFAULT_COMPARE, DEFAULT_PRESET, isCompare, isPreset, resolvePeriod, type CompareMode, type RangePreset } from "@/lib/v2/summary/period";
import type { GaFieldMeta } from "@/lib/ga4";
// Registers the ga4:* cache kinds (the type import below is erased at runtime).
import "@/lib/sync/kinds";
import type { Ga4MetadataQuery } from "@/lib/sync/kinds";

export type RouteCtx = { params: Promise<{ id: string; reportId?: string }> };

export const GA4_SOURCE = "Google Analytics 4";

/** Signed-in account and its project, or the response to send instead. */
export async function ownedProject(ctx: RouteCtx): Promise<{ user: UserRow; project: Project } | NextResponse> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await ctx.params).id);
  const project = Number.isSafeInteger(id) && id > 0 ? await getProject(user.id, id) : null;
  if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404 });
  return { user, project };
}

export interface GaRouteContext {
  user: UserRow;
  project: Project;
  propertyId: string;
  token: string;
  timeZone: string | null;
  currency: string | null;
}

/** Everything a GA4 request needs, or the response to send instead (demo, not connected, no access). */
export async function gaRouteContext(ctx: RouteCtx): Promise<GaRouteContext | NextResponse> {
  const owned = await ownedProject(ctx);
  if (owned instanceof NextResponse) return owned;
  const { user, project } = owned;
  if (isDemoWebsite(project.websiteUrl)) {
    return NextResponse.json({ state: "demo", message: "Demo project: GA4 reports need a live GA4 property, so none are shown here." });
  }
  const blocked = await gaPreconditions(user, project, GA4_SOURCE);
  if (blocked) return NextResponse.json(blocked);
  if (!(await syncReady())) return NextResponse.json({ state: "unavailable", source: GA4_SOURCE, message: "GA4 reports need the shared cache (migration 0008)." });
  const token = await googleToken(user, GA4_SOURCE);
  if ("error" in token) return NextResponse.json(token.error);
  const propertyId = project.gaPropertyId!;
  const { timeZone, currency } = await gaContext(user, token.token, propertyId);
  setBackgroundRunner((fn) => after(fn));
  return { user, project, propertyId, token: token.token, timeZone, currency };
}

/** The period for a preset and comparison, resolved on the GA4 property's calendar. */
export function periodFor(preset: unknown, compare: unknown, timeZone: string | null) {
  const p = isPreset(preset as string) ? (preset as RangePreset) : DEFAULT_PRESET;
  const c = isCompare(compare as string) ? (compare as CompareMode) : DEFAULT_COMPARE;
  return resolvePeriod(p, c, propertyNow(timeZone));
}

/** The property's dimensions and metrics through the shared cache (one request per day per account and property). */
export async function cachedMetadata(c: GaRouteContext): Promise<{ dimensions: GaFieldMeta[]; metrics: GaFieldMeta[] } | { error: string }> {
  const query: Ga4MetadataQuery = { projectId: c.project.id, propertyId: c.propertyId };
  const r = await readThrough<Ga4MetadataQuery, { dimensions: GaFieldMeta[]; metrics: GaFieldMeta[] }>({ kind: "ga4:metadata", userId: c.user.id, projectId: c.project.id, query, waitMs: 20_000 });
  if (r.payload) return r.payload;
  return { error: r.state === "pending" ? "GA4 field list is still loading. Try again in a moment." : (r.error ?? "Couldn't load the GA4 field list.") };
}

export type CacheInfo = { state: "fresh" | "stale"; fetchedAt: number | null; refreshing: boolean; lastError: string | null; cooldown?: unknown };

export function cacheInfo(r: { state: string; fetchedAt?: number | null; refreshing?: boolean; error?: string | null; cooldown?: unknown }): CacheInfo {
  return { state: r.state === "stale" ? "stale" : "fresh", fetchedAt: r.fetchedAt ?? null, refreshing: Boolean(r.refreshing), lastError: r.error ?? null, cooldown: r.cooldown };
}

/** Structure, field names from the property's metadata, then GA4's own compatibility check. */
export async function validateSpec(c: GaRouteContext, raw: unknown): Promise<{ ok: true; spec: ReportSpec } | { ok: false; errors: string[]; incompatible?: { dimensions: string[]; metrics: string[] } }> {
  const n = normalizeSpec(raw);
  if ("errors" in n) return { ok: false, errors: n.errors };
  const meta = await cachedMetadata(c);
  if ("error" in meta) return { ok: false, errors: [meta.error] };
  const unknown = unknownFields(n.spec, meta);
  if (unknown.length) return { ok: false, errors: [`Not available in this GA4 property: ${unknown.join(", ")}.`] };
  try {
    const bad = await checkCompatibility(c.token, c.propertyId, { dimensions: n.spec.dimensions, metrics: n.spec.metrics, dimensionFilter: filterExpression(n.spec.filters) });
    if (bad.dimensions.length || bad.metrics.length) {
      return { ok: false, errors: [`GA4 can't combine these in one report: ${[...bad.dimensions, ...bad.metrics].join(", ")}. Remove one side of the conflict.`], incompatible: bad };
    }
  } catch (e) {
    return { ok: false, errors: [cleanGaError(e instanceof Error ? e.message : String(e)).message] };
  }
  return { ok: true, spec: n.spec };
}
