// One HTTP path for provider reads (Search Console, GA4, Asana, SE Ranking, page metadata), so limits hold across
// every server instance:
// - Rate windows per quota scope ("bucket"), stored in Postgres (provider_rate): e.g. one SE Ranking key is limited
//   to 5 requests per second however many instances use it.
// - Cool-downs: a 429/503 sets a shared cool-down for the bucket (Retry-After when the provider sends one), so
//   other instances wait instead of piling on.
// - Bounded retries with exponential backoff and jitter; long waits hand back ProviderBusyError so a job can be
//   rescheduled instead of holding a request open.
// - Non-idempotent requests (writes) are never repeated after a timeout or network error: the outcome is unknown.
// Every request is counted for the job that made it (lib/sync/context.ts).
// Before migration 0008 exists, the shared tables are skipped and only the in-request retries apply.

import { db, tableExists } from "@/lib/db";
import { noteProviderRequest, noteRetry } from "./context";

export interface RateLimit {
  max: number;
  windowMs: number;
}

export class ProviderBusyError extends Error {
  constructor(
    readonly provider: string,
    readonly until: number,
    readonly status: number | null,
  ) {
    super(`${provider} is rate-limiting requests; retrying after ${new Date(until).toISOString()}.`);
    this.name = "ProviderBusyError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number) => ms + Math.floor(Math.random() * Math.min(500, ms / 2 + 1));

let shared: Promise<boolean> | null = null;
function sharedTables(): Promise<boolean> {
  if (!shared) shared = tableExists("provider_rate").catch(() => false);
  return shared;
}

/** Parses Retry-After (seconds or an HTTP date) into milliseconds from now; null when absent or invalid. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const s = Number(header);
  if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, 24 * 3600_000);
  const t = Date.parse(header);
  return Number.isFinite(t) ? Math.max(0, Math.min(t - now, 24 * 3600_000)) : null;
}

/** Takes one request slot in a bucket's current window, waiting for the next window (up to maxWaitMs). */
export async function acquireSlot(bucket: string, limit: RateLimit, maxWaitMs = 15_000): Promise<void> {
  if (!(await sharedTables())) return;
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const now = Date.now();
    const taken = await db
      .prepare(
        `UPDATE provider_rate SET
           used = CASE WHEN window_start + ? <= ? THEN 1 ELSE used + 1 END,
           window_start = CASE WHEN window_start + ? <= ? THEN ? ELSE window_start END,
           updated_at = ?
         WHERE bucket = ? AND (window_start + ? <= ? OR used < ?) RETURNING used`,
      )
      .get(limit.windowMs, now, limit.windowMs, now, now, now, bucket, limit.windowMs, now, limit.max);
    if (taken) return;
    const inserted = await db
      .prepare("INSERT INTO provider_rate (bucket, window_start, used, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT (bucket) DO NOTHING RETURNING used")
      .get(bucket, now, now);
    if (inserted) return;
    const row = (await db.prepare("SELECT window_start FROM provider_rate WHERE bucket = ?").get(bucket)) as { window_start: number } | undefined;
    const wait = Math.max(5, Number(row?.window_start ?? now) + limit.windowMs - now);
    if (Date.now() + wait > deadline) throw new ProviderBusyError(bucket.split(":")[0], Date.now() + wait, null);
    await sleep(jitter(wait));
  }
}

async function cooldownUntil(bucket: string): Promise<number> {
  if (!(await sharedTables())) return 0;
  const r = (await db.prepare("SELECT until FROM provider_cooldown WHERE bucket = ?").get(bucket)) as { until: number } | undefined;
  return Number(r?.until ?? 0);
}

export async function setCooldown(bucket: string, until: number, reason: string): Promise<void> {
  if (!(await sharedTables())) return;
  await db
    .prepare(
      `INSERT INTO provider_cooldown (bucket, until, reason, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (bucket) DO UPDATE SET until = GREATEST(provider_cooldown.until, EXCLUDED.until), reason = EXCLUDED.reason, updated_at = EXCLUDED.updated_at`,
    )
    .run(bucket, until, reason.slice(0, 200), Date.now());
}

export interface ProviderRequest {
  provider: string;
  /** Quota scope, e.g. "seranking:key:<fingerprint>", "ga4:property:123", "gsc:site:<site>", "asana:token:<fp>". */
  bucket: string;
  limit: RateLimit;
  url: string;
  init?: RequestInit;
  timeoutMs?: number;
  /** Retries after 429 / 502 / 503 / 504 (and, for idempotent requests, network errors and timeouts). */
  maxRetries?: number;
  /** Longest single wait to do in-request; anything longer becomes ProviderBusyError. */
  maxInlineWaitMs?: number;
}

/** Sends a provider request through the shared limits. Returns the final Response (ok or a non-retryable error). */
export async function providerFetch(req: ProviderRequest): Promise<Response> {
  const method = (req.init?.method ?? "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD" || /:runReport$|\/searchAnalytics\/query$/.test(req.url);
  const maxRetries = req.maxRetries ?? 3;
  const maxInline = req.maxInlineWaitMs ?? 10_000;
  for (let attempt = 0; ; attempt++) {
    const cool = await cooldownUntil(req.bucket);
    const now = Date.now();
    if (cool > now) {
      if (cool - now > maxInline) throw new ProviderBusyError(req.provider, cool, 429);
      await sleep(jitter(cool - now));
    }
    await acquireSlot(req.bucket, req.limit);
    noteProviderRequest(req.provider);
    let res: Response;
    try {
      res = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(req.timeoutMs ?? 60_000), cache: "no-store" });
    } catch (e) {
      // A write whose request may have reached the provider is never repeated blindly.
      if (!idempotent || attempt >= maxRetries) throw e;
      noteRetry();
      await sleep(jitter(500 * 2 ** attempt));
      continue;
    }
    if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
      const wait = retryAfterMs(res.headers.get("Retry-After")) ?? 1000 * 2 ** attempt;
      if (res.status === 429 || res.status === 503) await setCooldown(req.bucket, Date.now() + wait, `HTTP ${res.status}`);
      const retryable = idempotent || res.status === 429; // a 429 wasn't processed, so even a write may be resent
      if (retryable && attempt < maxRetries && wait <= maxInline) {
        noteRetry();
        await res.body?.cancel().catch(() => {});
        await sleep(jitter(wait));
        continue;
      }
      if (wait > maxInline) throw new ProviderBusyError(req.provider, Date.now() + wait, res.status);
    }
    return res;
  }
}
