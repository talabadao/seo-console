"use client";

// Browser side of the project summaries: a small request queue (at most
// MAX_CONCURRENT at once) and a short sessionStorage cache per period. The server keeps the shared, persistent
// cache (lib/sync/cache.ts); this tab cache only avoids re-asking while you move between pages. A summary with a
// part still loading for the first time ("pending") isn't cached here, and the page polls until it's ready.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ProjectSummary, SummaryPart } from "@/lib/v2/summary/types";
import { DEFAULT_COMPARE, DEFAULT_PRESET, isCompare, isPreset, type CompareMode, type RangePreset } from "@/lib/v2/summary/period";

const MAX_CONCURRENT = 3;
const TTL_MS = 10 * 60_000;
const PERIOD_KEY = "seo-v2-period";

let active = 0;
const waiting: (() => void)[] = [];

async function gated<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const inflight = new Map<string, Promise<ProjectSummary>>();

export interface SummaryRequest {
  projectId: number;
  preset: RangePreset;
  compare: CompareMode;
  parts: SummaryPart[];
  detail?: boolean;
}

function urlFor(r: SummaryRequest, refresh = false) {
  const q = new URLSearchParams({ preset: r.preset, compare: r.compare, parts: r.parts.join(",") });
  if (r.detail) q.set("detail", "1");
  if (refresh) q.set("refresh", "1");
  return `/api/v2/summary/${r.projectId}?${q}`;
}

function readCache(key: string): ProjectSummary | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { at, value } = JSON.parse(raw) as { at: number; value: ProjectSummary };
    return Date.now() - at < TTL_MS ? value : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: ProjectSummary) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch {}
}

export async function fetchSummary(r: SummaryRequest, refresh = false): Promise<ProjectSummary> {
  const key = `seo-v2-summary:${urlFor(r)}`;
  if (!refresh) {
    const hit = readCache(key);
    if (hit) return hit;
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const p = gated(async () => {
    const res = await fetch(urlFor(r, refresh));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
    if (!hasPending(body as ProjectSummary, r.parts)) writeCache(key, body as ProjectSummary);
    return body as ProjectSummary;
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** True while any requested part is still loading for the first time on the server. */
export function hasPending(s: ProjectSummary, parts: SummaryPart[]): boolean {
  return parts.some((p) => (s as unknown as Record<string, { state?: string } | undefined>)[p]?.state === "pending");
}

const POLL_MS = 3000;
const MAX_POLLS = 40;

export type Loaded = { status: "loading" } | { status: "ready"; summary: ProjectSummary } | { status: "error"; message: string };

/** Loads one project's summary; a higher `nonce` forces a refresh. */
export function useSummary(r: SummaryRequest | null, nonce = 0): Loaded {
  const key = r ? `${urlFor(r)}#${nonce}` : "";
  const [result, setResult] = useState<{ key: string; value: Loaded } | null>(null);
  useEffect(() => {
    if (!r) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = (refresh: boolean, polls: number) =>
      fetchSummary(r, refresh)
        .then((summary) => {
          if (!live) return;
          setResult({ key, value: { status: "ready", summary } });
          // A part still fetching for the first time: ask again shortly (the server joins the same job).
          if (hasPending(summary, r.parts) && polls < MAX_POLLS) timer = setTimeout(() => void load(false, polls + 1), POLL_MS);
        })
        .catch((e) => live && setResult({ key, value: { status: "error", message: e instanceof Error ? e.message : String(e) } }));
    void load(nonce > 0, 0);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return result && result.key === key ? result.value : { status: "loading" };
}

// ---- small values remembered in this browser (localStorage), read without effects ----

const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}
function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
  listeners.forEach((fn) => fn());
}

/** A JSON value from localStorage; `fallback` on the server, when missing or when `parse` rejects it. */
export function useStored<T>(key: string, fallback: T, parse: (raw: unknown) => T | null): T {
  const raw = useSyncExternalStore(subscribe, () => readRaw(key), () => null);
  if (raw == null) return fallback;
  try {
    return parse(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

/** The selected performance period, remembered across pages in this browser. */
const DEFAULT_PERIOD = { preset: DEFAULT_PRESET, compare: DEFAULT_COMPARE };
const parsePeriod = (v: unknown) => {
  const o = v as { preset?: string; compare?: string } | null;
  return o && isPreset(o.preset) && isCompare(o.compare) ? { preset: o.preset, compare: o.compare } : null;
};
export function usePeriodChoice(): [{ preset: RangePreset; compare: CompareMode }, (v: { preset: RangePreset; compare: CompareMode }) => void] {
  const v = useStored(PERIOD_KEY, DEFAULT_PERIOD, parsePeriod);
  return [v, (next) => writeStored(PERIOD_KEY, next)];
}
