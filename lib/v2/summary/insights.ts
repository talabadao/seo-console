// Search Console "Insights"-style lists (Top / Trending up / Trending down)
// built from ordinary Search Analytics rows. This is SEO Console's own
// summary, not Google's Insights product: Google doesn't publish its
// trending or grouping rules, so trends here are simply the largest
// changes in clicks between the two periods.
//
// previousClicks:
// - a number when the row was in the comparison period's results, or when
//   those results were complete (then a missing row really had 0 clicks);
// - null when the comparison results were cut off at the row limit and the
//   row wasn't among them (its previous clicks are unknown). Such rows can
//   appear in Top, but never in the trending lists.

import type { InsightLists, InsightRow } from "./types";

export function insightLists(
  current: { key: string; clicks: number }[],
  previous: { key: string; clicks: number }[] | null,
  previousComplete: boolean,
  n = 5,
): InsightLists {
  const prev = new Map((previous ?? []).map((r) => [r.key, r.clicks]));
  const rows: InsightRow[] = current.map((r) => ({
    key: r.key,
    clicks: r.clicks,
    previousClicks: previous == null ? null : prev.has(r.key) ? prev.get(r.key)! : previousComplete ? 0 : null,
  }));
  // Rows that lost all their clicks still trend down: add them from the comparison period.
  if (previous) {
    const seen = new Set(current.map((r) => r.key));
    for (const p of previous) if (!seen.has(p.key) && p.clicks > 0) rows.push({ key: p.key, clicks: 0, previousClicks: p.clicks });
  }
  const known = rows.filter((r) => r.previousClicks != null);
  const delta = (r: InsightRow) => r.clicks - (r.previousClicks ?? 0);
  return {
    top: rows.filter((r) => r.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, n),
    up: known.filter((r) => delta(r) > 0).sort((a, b) => delta(b) - delta(a) || b.clicks - a.clicks).slice(0, n),
    down: known.filter((r) => delta(r) < 0).sort((a, b) => delta(a) - delta(b) || b.clicks - a.clicks).slice(0, n),
  };
}

/** A URL shown readably: host-less path for the site's own pages, without the trailing slash or protocol. */
export function readableUrl(url: string): { path: string; host: string } {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname + u.search + u.hash);
    return { host: u.hostname.replace(/^www\./, ""), path: path === "/" ? "/ (home)" : path };
  } catch {
    return { host: "", path: url };
  }
}
