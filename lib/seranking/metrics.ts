// SE Ranking ranking definitions with no network or database access, so client components and demo data can use
// them (see ./rankings for the definitions and fetching).

export interface RankCounts {
  top3: number;
  top5: number;
  top10: number;
  /** Keywords in the top 100 at that check. */
  ranked: number;
  /** Keywords with a check at that date (the average's denominator). */
  checked: number;
  /** SE Ranking's average: keywords outside the top 100 count as 100. Null when nothing was checked. */
  avgPosition: number | null;
  /** Mean of ranked keywords only; null when none rank. */
  rankedAvgPosition: number | null;
}

/** A position as a rank (1-100), or null when not ranking (0, missing or outside the top 100). */
export function rankOf(pos: number | null | undefined): number | null {
  return pos != null && pos >= 1 && pos <= 100 ? pos : null;
}

/** SE Ranking counts a keyword outside the top 100 as position 100 in its average. */
export const UNRANKED_AS = 100;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Cumulative counts and averages. `positions` has one entry per tracked keyword: a number when the keyword
 * was checked at that date (0 or more than 100 = not ranking), undefined/null when it had no check.
 */
export function rankCounts(positions: Array<number | null | undefined>): RankCounts {
  const checked = positions.filter((p): p is number => p != null);
  const ranks = checked.map(rankOf).filter((p): p is number => p !== null);
  return {
    top3: ranks.filter((p) => p <= 3).length,
    top5: ranks.filter((p) => p <= 5).length,
    top10: ranks.filter((p) => p <= 10).length,
    ranked: ranks.length,
    checked: checked.length,
    avgPosition: checked.length ? round1(checked.reduce((a, p) => a + (rankOf(p) ?? UNRANKED_AS), 0) / checked.length) : null,
    rankedAvgPosition: ranks.length ? round1(ranks.reduce((a, b) => a + b, 0) / ranks.length) : null,
  };
}

/** Position at the latest check on or before `date`; undefined when there's no check that early. */
export function positionOnOrBefore(checks: Array<{ date: string; pos: number }>, date: string): number | undefined {
  let found: { date: string; pos: number } | undefined;
  for (const c of checks) if (c.date <= date && (!found || c.date > found.date)) found = c;
  return found?.pos;
}
