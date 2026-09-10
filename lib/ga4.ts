const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";

async function gfetch(url: string, token: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GA4 API ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
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

export async function getPropertyCurrency(token: string, propertyId: string): Promise<string | null> {
  try {
    const d = await gfetch(`${ADMIN}/${propertyId}`, token);
    return d.currencyCode ?? null;
  } catch {
    return null;
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

export function eqFilter(fieldName: string, value: string) {
  return { filter: { fieldName, stringFilter: { matchType: "EXACT", value } } };
}
export const KEY_EVENT_FILTER = { filter: { fieldName: "isKeyEvent", stringFilter: { value: "true" } } };

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
  if (/organic/i.test(channel || "")) return "organic";
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
