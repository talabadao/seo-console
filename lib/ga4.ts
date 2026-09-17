const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// GA4's Data API caps how many requests a property can have in flight at
// once ("Exhausted concurrent requests quota") — easy to hit here since
// several dashboards (Analytics, Opportunities, Weekly Report) issue their
// own batch of requests in parallel. Retry 429s with backoff instead of
// surfacing the raw error, honoring Retry-After when Google sends one.
const MAX_429_RETRIES = 4;

async function gfetch(url: string, token: string, init?: RequestInit) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    if (res.ok) return res.json();

    const body = await res.text();
    if (res.status === 429 && attempt < MAX_429_RETRIES) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      const delay = isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** attempt + Math.random() * 250;
      await sleep(delay);
      continue;
    }
    // Keep enough of the body that the "API not enabled" enable-URL survives
    // truncation — Google's error payloads (with `details`) can run long.
    throw new Error(`GA4 API ${res.status}: ${body.slice(0, 2000)}`);
  }
}

// ---------- Admin API: property discovery ----------

export interface GaProperty {
  propertyId: string; // "properties/123456789"
  displayName: string;
  accountName: string;
}

export async function listGaProperties(token: string): Promise<GaProperty[]> {
  const out: GaProperty[] = [];
  let pageToken = "";
  do {
    const url = `${ADMIN}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const data = await gfetch(url, token);
    for (const acc of data.accountSummaries ?? []) {
      for (const p of acc.propertySummaries ?? []) {
        if (!p.property) continue;
        out.push({
          propertyId: p.property,
          displayName: p.displayName ?? p.property,
          accountName: acc.displayName ?? "",
        });
      }
    }
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

export interface GaPropertyMeta {
  currency: string | null;
  timeZone: string | null;
}

export async function getPropertyMeta(token: string, propertyId: string): Promise<GaPropertyMeta> {
  try {
    const d = await gfetch(`${ADMIN}/${propertyId}`, token);
    return { currency: d.currencyCode ?? null, timeZone: d.timeZone ?? null };
  } catch {
    return { currency: null, timeZone: null };
  }
}

/**
 * "Now", expressed as the wall-clock moment currently showing in the GA4
 * property's own reporting timezone — used as the anchor for date-range math
 * (resolveRange/reportWindows) instead of the server's clock. GA4 date ranges
 * are interpreted in the property's timezone, so anchoring to the server's
 * UTC "today" instead could be off by a day (or a few hours' worth of
 * sessions) for any property not itself in UTC, which shows up as SEO
 * Console's totals running consistently a bit under (or over) a reference
 * report. Relies on this process itself running in UTC (true for Vercel
 * serverless by default) — format() elsewhere reads a Date's LOCAL fields,
 * which only line up with the property's calendar day when the host's own
 * timezone is UTC.
 */
export function propertyNow(timeZone: string | null, base: Date = new Date()): Date {
  if (!timeZone) return base;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(base);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
    return new Date(
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`,
    );
  } catch {
    return base;
  }
}

// ---------- Data API ----------

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface GaRow {
  dims: string[];
  range: number; // 0 = current, 1 = previous
  metrics: number[];
}

interface RunReportOpts {
  dimensions: string[];
  metrics: string[];
  dateRanges: DateRange[];
  dimensionFilter?: unknown;
  orderBys?: unknown[];
  limit?: number;
  keepEmptyRows?: boolean;
}

export async function runReport(
  token: string,
  propertyId: string,
  opts: RunReportOpts,
): Promise<{ rows: GaRow[]; metricHeaders: string[]; sampled: boolean; rowCount: number }> {
  const body = {
    dateRanges: opts.dateRanges,
    dimensions: opts.dimensions.map((name) => ({ name })),
    metrics: opts.metrics.map((name) => ({ name })),
    ...(opts.dimensionFilter ? { dimensionFilter: opts.dimensionFilter } : {}),
    ...(opts.orderBys ? { orderBys: opts.orderBys } : {}),
    limit: String(opts.limit ?? 100000),
    keepEmptyRows: opts.keepEmptyRows ?? false,
  };
  const data = await gfetch(`${DATA}/${propertyId}:runReport`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });

  const multi = opts.dateRanges.length > 1;
  const metricHeaders: string[] = (data.metricHeaders ?? []).map(
    (h: { name: string }) => h.name,
  );
  const rows: GaRow[] = (data.rows ?? []).map(
    (r: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }) => {
      const dv = (r.dimensionValues ?? []).map((v) => v.value ?? "");
      const mv = (r.metricValues ?? []).map((v) => Number(v.value ?? 0));
      let range = 0;
      let dims = dv;
      if (multi) {
        const last = dv[dv.length - 1] ?? "date_range_0";
        range = Number(last.replace("date_range_", "")) || 0;
        dims = dv.slice(0, -1);
      }
      return { dims, range, metrics: mv };
    },
  );
  const sampled =
    Array.isArray(data.metadata?.samplingMetadatas) && data.metadata.samplingMetadatas.length > 0;
  return { rows, metricHeaders, sampled, rowCount: Number(data.rowCount ?? rows.length) };
}

/**
 * Caps how many tasks run at once. GA4's per-property concurrent-request
 * quota ("Exhausted concurrent requests quota") is easy to blow through when
 * a dashboard fires a wide Promise.all of its own queries — routing each
 * query through `sem.run(...)` (still inside a Promise.all, so tuple typing
 * and result ordering are unaffected) keeps a caller's own burst small
 * instead of relying solely on gfetch's 429 retry.
 */
export class Semaphore {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private limit: number) {}

  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }

  private release(): void {
    this.active--;
    this.queue.shift()?.();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export function eqFilter(fieldName: string, value: string) {
  return { filter: { fieldName, stringFilter: { matchType: "EXACT", value } } };
}
export function inFilter(fieldName: string, values: string[]) {
  return { filter: { fieldName, inListFilter: { values } } };
}
export const KEY_EVENT_FILTER = { filter: { fieldName: "isKeyEvent", stringFilter: { value: "true" } } };

/** Combine multiple dimensionFilter expressions with AND. */
export function andFilter(...filters: unknown[]) {
  return { andGroup: { expressions: filters } };
}

// ---------- AI-source classification ----------

export const DEFAULT_AI_DOMAINS = [
  "chatgpt.com",
  "chat.openai.com",
  "openai.com",
  "perplexity.ai",
  "gemini.google.com",
  "bard.google.com",
  "copilot.microsoft.com",
  "claude.ai",
  "you.com",
  "poe.com",
  "meta.ai",
  "phind.com",
  "chat.deepseek.com",
  "chat.mistral.ai",
  "grok.com",
];

export type TrafficKind = "organic" | "ai" | "other";

export function classifyTraffic(
  source: string,
  channel: string,
  aiDomains: string[],
): TrafficKind {
  const s = (source || "").toLowerCase();
  if (aiDomains.some((d) => d && (s === d || s.endsWith("." + d) || s.includes(d)))) return "ai";
  // Exact match on GA4's "Organic Search" channel group only — a substring
  // match on "organic" also swept in "Organic Social", "Organic Video", and
  // "Organic Shopping", which is why totals here ran ~15-20% ahead of a
  // reference report filtered to just Organic Search.
  if ((channel || "").trim().toLowerCase() === "organic search") return "organic";
  return "other";
}

// ---------- higher-level: trend breakdown ----------

export interface TrendRow {
  key: string;
  cur: number[]; // current-period metric values
  prev: number[]; // previous-period metric values
  isNew: boolean;
}

/** One row per (joined dimension), current + previous metrics side by side. */
export async function trendBreakdown(
  token: string,
  propertyId: string,
  opts: {
    dimensions: string[];
    metrics: string[];
    current: DateRange;
    previous: DateRange | null;
    dimensionFilter?: unknown;
    limit?: number;
  },
): Promise<{ rows: TrendRow[]; sampled: boolean; total: number }> {
  const dateRanges = opts.previous ? [opts.current, opts.previous] : [opts.current];
  const { rows, sampled, rowCount } = await runReport(token, propertyId, {
    dimensions: opts.dimensions,
    metrics: opts.metrics,
    dateRanges,
    dimensionFilter: opts.dimensionFilter,
    orderBys: [{ metric: { metricName: opts.metrics[0] }, desc: true }],
    limit: opts.limit ?? 5000,
  });

  const n = opts.metrics.length;
  const map = new Map<string, TrendRow>();
  for (const r of rows) {
    const key = r.dims.join(" / ");
    let row = map.get(key);
    if (!row) {
      row = { key, cur: Array(n).fill(0), prev: Array(n).fill(0), isNew: Boolean(opts.previous) };
      map.set(key, row);
    }
    if (r.range === 0) row.cur = r.metrics;
    else {
      row.prev = r.metrics;
      row.isNew = false;
    }
  }
  const out = [...map.values()].sort((a, b) => (b.cur[0] ?? 0) - (a.cur[0] ?? 0));
  return { rows: out, sampled, total: rowCount };
}

// ---------- error cleanup ----------

/**
 * Turn a raw "GA4 API 403: {json}" string into a short message, and — for the
 * common "API not enabled" case — the exact Google Cloud Console URL to fix it.
 */
export function cleanGaError(raw: string): { message: string; enableUrl: string | null } {
  const m = /GA4 API (\d+):\s*([\s\S]*)/.exec(raw);
  const code = m?.[1] ?? "";
  const body = m?.[2] ?? raw;

  // The "enable this API" URL is a plain substring — look for it whether or
  // not the JSON parses cleanly (Google's error bodies get long and our
  // truncated fetch body can cut the JSON off mid-object).
  const urlMatch = /(https:\/\/console\.developers\.google\.com\/apis\/api\/\S+)/.exec(body);
  if (urlMatch) {
    const enableUrl = urlMatch[1].replace(/[.,)\\"]+$/, "");
    const api = /apis\/api\/([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*)\//.exec(enableUrl)?.[1] ?? "This API";
    return { message: `${api} isn't enabled for this Google Cloud project yet.`, enableUrl };
  }

  try {
    const j = JSON.parse(body);
    const msg: string = j?.error?.message ?? body;
    return { message: code ? `${code}: ${msg.slice(0, 200)}` : msg.slice(0, 200), enableUrl: null };
  } catch {
    return { message: (code ? `${code}: ` : "") + body.slice(0, 250), enableUrl: null };
  }
}
