import type { SeRankDay } from "./types";

/** SE Ranking reports a competitor outside the top 100 as position 100, and the site itself as 0. */
export const NOT_RANKING = 100;

/** A position as a rank (1-99), or null when the keyword isn't in the top 100. */
export function rankOf(pos: number | null | undefined): number | null {
  return pos != null && pos > 0 && pos < NOT_RANKING ? pos : null;
}

/** Daily top-3 / top-10 counts and average position across keywords (each a list of daily checks). */
export function rankDays(keywords: Array<Array<{ date: string; pos: number }>>): SeRankDay[] {
  const byDate = new Map<string, { top3: number; top10: number; ranked: number; sum: number; n: number }>();
  for (const positions of keywords) {
    for (const p of positions) {
      const row = byDate.get(p.date) ?? { top3: 0, top10: 0, ranked: 0, sum: 0, n: 0 };
      const rank = rankOf(p.pos);
      if (rank !== null) {
        row.ranked++;
        if (rank <= 10) row.top10++;
        if (rank <= 3) row.top3++;
      }
      row.sum += rank ?? NOT_RANKING;
      row.n++;
      byDate.set(p.date, row);
    }
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, r]) => ({ date, top3: r.top3, top10: r.top10, ranked: r.ranked, avgPos: r.n ? Math.round((r.sum / r.n) * 10) / 10 : null }));
}

/** Host of a URL or bare domain, without www. */
export function hostOf(urlOrDomain: string): string {
  const raw = urlOrDomain.trim().toLowerCase();
  try {
    return new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  }
}

/** A domain belongs to a site when it's the site's host or one of its subdomains (both without www). */
export function belongsTo(domain: string, siteHost: string): boolean {
  if (!domain || !siteHost) return false;
  return domain === siteHost || domain.endsWith(`.${siteHost}`);
}
