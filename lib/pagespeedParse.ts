// Pure parsing of a PageSpeed Insights API response — no server imports, so
// the types can be shared with the Page Speed tab in the browser.

export type Strategy = "mobile" | "desktop";
export const STRATEGIES: Strategy[] = ["mobile", "desktop"];

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  learnMore: string | null;
  displayValue: string | null;
  /** Estimated load-time saving in ms (0 when Lighthouse gives none). */
  savingsMs: number;
  savingsBytes: number;
}

export interface PsiResult {
  score: number | null;
  // Lab (Lighthouse) metrics — ms, except CLS (unitless).
  fcp: number | null;
  lcp: number | null;
  tbt: number | null;
  cls: number | null;
  si: number | null;
  // Field (Chrome UX Report, real users, 75th percentile) — null when Google has no data.
  fieldLcp: number | null;
  fieldInp: number | null;
  fieldCls: number | null;
  fieldFcp: number | null;
  fieldTtfb: number | null;
  fieldCategory: string | null;
  /** True when the field numbers are for the whole origin, not this exact URL. */
  fieldOrigin: boolean;
  recommendations: Recommendation[];
}

// Audits that are the metrics themselves, not something to fix.
const METRIC_AUDITS = new Set([
  "first-contentful-paint",
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
  "interactive",
  "max-potential-fid",
  "first-meaningful-paint",
]);

interface LhAudit {
  id: string;
  title?: string;
  description?: string;
  score?: number | null;
  scoreDisplayMode?: string;
  displayValue?: string;
  numericValue?: number;
  details?: { type?: string; overallSavingsMs?: number; overallSavingsBytes?: number };
  metricSavings?: Record<string, number>;
}

function recommendationsFrom(audits: Record<string, LhAudit>): Recommendation[] {
  const out: Recommendation[] = [];
  for (const a of Object.values(audits)) {
    if (!a?.id || METRIC_AUDITS.has(a.id) || !a.title) continue;
    if (a.scoreDisplayMode === "notApplicable" || a.scoreDisplayMode === "manual") continue;
    // Older Lighthouse reports a single saving on "opportunity" audits; newer
    // ones give a per-metric estimate. Time-based savings only (CLS is unitless).
    const ms = Math.max(
      a.details?.overallSavingsMs ?? 0,
      a.metricSavings?.LCP ?? 0,
      a.metricSavings?.FCP ?? 0,
      a.metricSavings?.TBT ?? 0,
      a.metricSavings?.INP ?? 0,
    );
    const failing = typeof a.score === "number" && a.score < 0.9;
    if (!failing && ms <= 0) continue;
    if (a.scoreDisplayMode === "informative" && ms <= 0) continue;
    const desc = a.description ?? "";
    out.push({
      id: a.id,
      title: a.title,
      description: desc.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim(),
      learnMore: /\]\((https?:\/\/[^)]+)\)/.exec(desc)?.[1] ?? null,
      displayValue: a.displayValue ?? null,
      savingsMs: Math.round(ms),
      savingsBytes: Math.round(a.details?.overallSavingsBytes ?? 0),
    });
  }
  return out.sort((x, y) => y.savingsMs - x.savingsMs || y.savingsBytes - x.savingsBytes).slice(0, 15);
}

export function parsePsi(json: unknown): PsiResult {
  const j = json as {
    lighthouseResult?: {
      categories?: { performance?: { score?: number | null } };
      audits?: Record<string, LhAudit>;
    };
    loadingExperience?: FieldData;
    originLoadingExperience?: FieldData;
  };
  type FieldData = {
    metrics?: Record<string, { percentile?: number }>;
    overall_category?: string;
    origin_fallback?: boolean;
  };
  const audits = j.lighthouseResult?.audits ?? {};
  const num = (id: string) => {
    const v = audits[id]?.numericValue;
    return typeof v === "number" ? v : null;
  };
  const score = j.lighthouseResult?.categories?.performance?.score;

  const pageField = j.loadingExperience?.metrics ? j.loadingExperience : undefined;
  const field = pageField ?? (j.originLoadingExperience?.metrics ? j.originLoadingExperience : undefined);
  const p75 = (k: string) => {
    const v = field?.metrics?.[k]?.percentile;
    return typeof v === "number" ? v : null;
  };
  const cls75 = p75("CUMULATIVE_LAYOUT_SHIFT_SCORE");

  return {
    score: typeof score === "number" ? Math.round(score * 100) : null,
    fcp: num("first-contentful-paint"),
    lcp: num("largest-contentful-paint"),
    tbt: num("total-blocking-time"),
    cls: num("cumulative-layout-shift"),
    si: num("speed-index"),
    fieldLcp: p75("LARGEST_CONTENTFUL_PAINT_MS"),
    fieldInp: p75("INTERACTION_TO_NEXT_PAINT"),
    fieldCls: cls75 == null ? null : cls75 / 100, // CrUX reports CLS ×100
    fieldFcp: p75("FIRST_CONTENTFUL_PAINT_MS"),
    fieldTtfb: p75("EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
    fieldCategory: field?.overall_category ?? null,
    fieldOrigin: Boolean(field && (!pageField || pageField.origin_fallback)),
    recommendations: recommendationsFrom(audits),
  };
}
