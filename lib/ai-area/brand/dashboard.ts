import { countMentionsAny, matchesBrand } from "../mentions";
import type { TrackingConfig } from "../tracking/types";
import { brandTerms } from "./analyze";
import { factKey } from "./store";
import { PLATFORMS, type BrandResponse, type Cycle, type CycleSummary, type FactVerdict, type PerceptionSummary, type Platform, type Sentiment } from "./types";

export interface DashboardFilters {
  platform: Platform | "all";
  promptType: "all" | "branded" | "unbranded";
  topic: string;
}

export interface BrandStat {
  name: string;
  isTarget: boolean;
  isCompetitor: boolean;
  visibility: number;
  mentions: number;
  avgPosition: number | null;
  avgSentiment: number | null;
  knownFor: string[];
}

export interface Dashboard {
  cycles: Array<Pick<CycleSummary, "id" | "startedAt" | "status" | "done" | "total" | "costUsd" | "serpCredits" | "note">>;
  topics: string[];
  latestCycleId: string | null;
  /**
   * Latest run: total = planned answers collected so far; present = answers that exist and were analysed;
   * mentioned = analysed answers that mention the brand. collected and unanalysed cover answers that exist but
   * couldn't be analysed (e.g. paid model calls are off on Preview); literal = collected answers that name the
   * brand or an alias word for word (no model involved).
   */
  answers: { total: number; present: number; mentioned: number; collected: number; unanalysed: number; literal: number };
  perception: {
    score: number | null;
    delta: number | null;
    shares: Record<Sentiment, number>;
    summary: PerceptionSummary | null;
    summaryScope: Platform | "all";
    sourceCount: number;
    topSources: string[];
    updatedAt: string | null;
  };
  trend: Array<{ cycleId: string; date: string; score: number | null; visibility: number; shares: Record<Sentiment, number> }>;
  brands: BrandStat[];
  attributes: Array<{ attribute: string; share: number; status: "leading" | "parity" | "behind"; target: number | null; others: number | null; mentions: number }>;
  facts: Array<{ key: string; statement: string; detail: string; platform: Platform; date: string; verdict: FactVerdict | null; sentiment: Sentiment }>;
  sources: {
    counts: Record<Sentiment, number>;
    total: number;
    platforms: Platform[];
    claims: Array<{ claim: string; detail: string; sentiment: Sentiment; platform: Platform; source: { domain: string; url: string } | null; count: number }>;
    domains: Array<{ domain: string; count: number; sentiment: Record<Sentiment, number> }>;
  };
}

const SCORE: Record<Sentiment, number> = { positive: 100, neutral: 50, negative: 0 };
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const classify = (score: number): Sentiment => (score >= 60 ? "positive" : score <= 40 ? "negative" : "neutral");

function keep(r: BrandResponse, cycle: Cycle, f: DashboardFilters): boolean {
  if (f.platform !== "all" && r.platform !== f.platform) return false;
  const prompt = cycle.prompts[r.promptId];
  if (!prompt) return false;
  if (f.promptType === "branded" && !prompt.branded) return false;
  if (f.promptType === "unbranded" && prompt.branded) return false;
  if (f.topic !== "all" && prompt.topic !== f.topic) return false;
  return true;
}

function shares(claims: Array<{ sentiment: Sentiment }>): Record<Sentiment, number> {
  const total = claims.length;
  return {
    positive: pct(claims.filter((c) => c.sentiment === "positive").length, total),
    neutral: pct(claims.filter((c) => c.sentiment === "neutral").length, total),
    negative: pct(claims.filter((c) => c.sentiment === "negative").length, total),
  };
}

/** Brands named in answers are merged by name, case-insensitively, with the tracked brand and competitors matched via their aliases. */
function canonicalName(name: string, config: TrackingConfig): { name: string; isTarget: boolean; isCompetitor: boolean } {
  if (config.brand.name && matchesBrand(name, brandTerms(config.brand))) return { name: config.brand.name, isTarget: true, isCompetitor: false };
  const competitor = config.competitors.find((c) => matchesBrand(name, [c.name, ...c.aliases].filter(Boolean)));
  if (competitor) return { name: competitor.name, isTarget: false, isCompetitor: true };
  return { name: name.trim(), isTarget: false, isCompetitor: false };
}

export function buildDashboard(
  summaries: CycleSummary[],
  cycles: Cycle[],
  config: TrackingConfig,
  filters: DashboardFilters,
  verdicts: Record<string, FactVerdict>
): Dashboard {
  const ordered = [...cycles].sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(summaries.map((s) => [s.id, s]));
  const filtered = ordered.map((cycle) => ({ cycle, responses: cycle.responses.filter((r) => keep(r, cycle, filters)) }));
  const topics = [...new Set(ordered.flatMap((c) => Object.values(c.prompts).map((p) => p.topic)))].filter(Boolean).sort();

  const trend = filtered.map(({ cycle, responses }) => {
    const present = responses.filter((r) => r.present && r.analysis);
    const mentioned = present.filter((r) => r.analysis?.brandMentioned);
    const claims = mentioned.flatMap((r) => r.analysis?.claims ?? []);
    return {
      cycleId: cycle.id,
      date: byId.get(cycle.id)?.startedAt ?? cycle.id.slice(0, 10),
      score: round1(avg(mentioned.map((r) => r.analysis?.brandSentiment ?? 50))),
      visibility: pct(mentioned.length, present.length),
      shares: shares(claims),
    };
  });

  const latest = filtered.at(-1);
  const previous = filtered.at(-2);
  const latestResponses = latest?.responses ?? [];
  const present = latestResponses.filter((r) => r.present && r.analysis);
  const mentioned = present.filter((r) => r.analysis?.brandMentioned);
  const targetClaims = mentioned.flatMap((r) => (r.analysis?.claims ?? []).map((c) => ({ ...c, response: r })));
  const score = trend.at(-1)?.score ?? null;
  const prevScore = previous ? trend.at(-2)?.score ?? null : null;

  // Sources cited by answers that mention the brand, labelled with that answer's sentiment.
  const sourceSentiment = new Map<string, { domain: string; votes: Record<Sentiment, number> }>();
  for (const r of mentioned) {
    const label = classify(r.analysis?.brandSentiment ?? 50);
    for (const s of r.sources) {
      const entry = sourceSentiment.get(s.url) ?? { domain: s.domain, votes: { positive: 0, neutral: 0, negative: 0 } };
      entry.votes[label]++;
      sourceSentiment.set(s.url, entry);
    }
  }
  const sourceCounts: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0 };
  const domainMap = new Map<string, { count: number; sentiment: Record<Sentiment, number> }>();
  for (const { domain, votes } of sourceSentiment.values()) {
    const label = (Object.entries(votes) as Array<[Sentiment, number]>).sort((a, b) => b[1] - a[1])[0][0];
    sourceCounts[label]++;
    const d = domainMap.get(domain) ?? { count: 0, sentiment: { positive: 0, neutral: 0, negative: 0 } };
    d.count++;
    d.sentiment[label]++;
    domainMap.set(domain, d);
  }
  const domains = [...domainMap.entries()].map(([domain, d]) => ({ domain, ...d })).sort((a, b) => b.count - a.count);

  // Brands across the latest cycle: visibility, position, sentiment, what they're known for.
  const brandMap = new Map<string, { isTarget: boolean; isCompetitor: boolean; responses: Set<string>; positions: number[]; sentiments: number[]; positives: Map<string, number> }>();
  const ensureBrand = (canon: ReturnType<typeof canonicalName>) => {
    const entry = brandMap.get(canon.name) ?? {
      isTarget: canon.isTarget,
      isCompetitor: canon.isCompetitor,
      responses: new Set<string>(),
      positions: [] as number[],
      sentiments: [] as number[],
      positives: new Map<string, number>(),
    };
    brandMap.set(canon.name, entry);
    return entry;
  };
  if (config.brand.name) ensureBrand({ name: config.brand.name, isTarget: true, isCompetitor: false });
  for (const c of config.competitors) ensureBrand({ name: c.name, isTarget: false, isCompetitor: true });
  present.forEach((r, i) => {
    for (const b of r.analysis?.brands ?? []) {
      const canon = b.isTarget ? { name: config.brand.name || b.name, isTarget: true, isCompetitor: false } : canonicalName(b.name, config);
      const entry = ensureBrand(canon);
      const key = `${i}`;
      if (entry.responses.has(key)) continue;
      entry.responses.add(key);
      entry.positions.push(b.position);
      entry.sentiments.push(b.sentiment);
      for (const a of b.attributes) if (a.sentiment === "positive") entry.positives.set(a.attribute, (entry.positives.get(a.attribute) ?? 0) + 1);
    }
    // A literal mention the model didn't list still counts for visibility.
    if (r.analysis?.brandMentioned && config.brand.name) {
      const entry = ensureBrand({ name: config.brand.name, isTarget: true, isCompetitor: false });
      if (!entry.responses.has(`${i}`)) {
        entry.responses.add(`${i}`);
        if (r.analysis.brandPosition) entry.positions.push(r.analysis.brandPosition);
        if (r.analysis.brandSentiment !== null) entry.sentiments.push(r.analysis.brandSentiment);
      }
    }
  });
  for (const c of targetClaims) {
    if (c.sentiment !== "positive" || !config.brand.name) continue;
    const entry = ensureBrand({ name: config.brand.name, isTarget: true, isCompetitor: false });
    entry.positives.set(c.claim, (entry.positives.get(c.claim) ?? 0) + 1);
  }
  const brands: BrandStat[] = [...brandMap.entries()]
    .map(([name, e]) => ({
      name,
      isTarget: e.isTarget,
      isCompetitor: e.isCompetitor,
      mentions: e.responses.size,
      visibility: pct(e.responses.size, present.length),
      avgPosition: round1(avg(e.positions)),
      avgSentiment: round1(avg(e.sentiments)),
      knownFor: [...e.positives.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k),
    }))
    .filter((b) => b.isTarget || b.isCompetitor || b.mentions > 0)
    .sort((a, b) => Number(b.isTarget) - Number(a.isTarget) || b.mentions - a.mentions)
    .slice(0, 16);

  // Attributes: how the brand is judged on each one compared with the other brands in the same answers.
  const attr = new Map<string, { target: number[]; others: number[]; mentions: number }>();
  const addAttr = (name: string, score: number, isTarget: boolean) => {
    const a = attr.get(name) ?? { target: [], others: [], mentions: 0 };
    (isTarget ? a.target : a.others).push(score);
    a.mentions++;
    attr.set(name, a);
  };
  for (const r of present) {
    for (const b of r.analysis?.brands ?? []) {
      const isTarget = b.isTarget || (!!config.brand.name && matchesBrand(b.name, brandTerms(config.brand)));
      for (const a of b.attributes) addAttr(a.attribute, SCORE[a.sentiment], isTarget);
    }
  }
  for (const c of targetClaims) addAttr(c.attribute, SCORE[c.sentiment], true);
  const totalAttrMentions = [...attr.values()].reduce((s, a) => s + a.mentions, 0);
  const attributes = [...attr.entries()]
    .filter(([, a]) => a.target.length > 0)
    .map(([attribute, a]) => {
      const target = avg(a.target);
      const others = avg(a.others);
      const diff = target !== null && others !== null ? target - others : null;
      const status: "leading" | "parity" | "behind" =
        diff !== null ? (diff >= 10 ? "leading" : diff <= -10 ? "behind" : "parity") : target !== null && target >= 75 ? "leading" : target !== null && target <= 40 ? "behind" : "parity";
      return { attribute, share: pct(a.mentions, totalAttrMentions), status, target: round1(target), others: round1(others), mentions: a.mentions };
    })
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 15);

  // Facts: checkable statements, newest first, one per distinct statement.
  const factMap = new Map<string, Dashboard["facts"][number]>();
  for (const { cycle, responses } of [...filtered].reverse()) {
    for (const r of responses) {
      if (!r.analysis?.brandMentioned) continue;
      for (const c of r.analysis.claims) {
        if (c.kind !== "fact") continue;
        const key = factKey(c.detail || c.claim);
        if (factMap.has(key)) continue;
        factMap.set(key, { key, statement: c.detail || c.claim, detail: c.claim, platform: r.platform, date: byId.get(cycle.id)?.startedAt ?? r.at, verdict: verdicts[key] ?? null, sentiment: c.sentiment });
      }
    }
  }

  // Claims table: distinct claims in the latest cycle with where they came from.
  const claimMap = new Map<string, Dashboard["sources"]["claims"][number]>();
  for (const c of targetClaims) {
    const key = `${c.response.platform}:${c.claim.toLowerCase()}`;
    const existing = claimMap.get(key);
    if (existing) {
      existing.count++;
      continue;
    }
    const src = c.sourceIndex !== null ? c.response.sources[c.sourceIndex] : undefined;
    claimMap.set(key, { claim: c.claim, detail: c.detail, sentiment: c.sentiment, platform: c.response.platform, source: src ? { domain: src.domain, url: src.url } : null, count: 1 });
  }

  const scope: Platform | "all" = filters.platform;
  const latestCycle = latest?.cycle;
  return {
    cycles: summaries.map(({ id, startedAt, status, done, total, costUsd, serpCredits, note }) => ({ id, startedAt, status, done, total, costUsd, serpCredits, note })),
    topics,
    latestCycleId: latestCycle?.id ?? null,
    answers: {
      total: latestResponses.length,
      present: present.length,
      mentioned: mentioned.length,
      collected: latestResponses.filter((r) => r.present).length,
      unanalysed: latestResponses.filter((r) => r.present && !r.analysis).length,
      literal: latestResponses.filter((r) => r.present && countMentionsAny(r.text, brandTerms(config.brand)) > 0).length,
    },
    perception: {
      score,
      delta: score !== null && prevScore !== null ? round1(score - prevScore) : null,
      shares: shares(targetClaims),
      summary: latestCycle?.summaries[scope] ?? latestCycle?.summaries.all ?? null,
      summaryScope: latestCycle?.summaries[scope] ? scope : "all",
      sourceCount: sourceSentiment.size,
      topSources: domains.slice(0, 5).map((d) => d.domain),
      updatedAt: latestCycle ? byId.get(latestCycle.id)?.finishedAt ?? byId.get(latestCycle.id)?.startedAt ?? null : null,
    },
    trend,
    brands,
    attributes,
    facts: [...factMap.values()].slice(0, 200),
    sources: {
      counts: sourceCounts,
      total: sourceSentiment.size,
      platforms: PLATFORMS.filter((p) => mentioned.some((r) => r.platform === p)),
      claims: [...claimMap.values()].sort((a, b) => b.count - a.count),
      domains: domains.slice(0, 30),
    },
  };
}
