// AI answers vs customer reviews, adapted from the AI Brand Mention app. One metered OpenAI call compares the
// latest run's AI claims with the last 12 months of the project's analysed Google Maps reviews. The donor's
// weekly review refresh (more SerpApi searches) isn't ported: reviews are fetched from the Reviews screen.
import type { Project } from "@/lib/projects";
import type { LlmMeter } from "@/lib/providers/llm";
import type { TrackingConfig } from "../tracking/types";
import { compareWithCustomers, type AiClaimGroup } from "./analyze";
import { customerVoice } from "./customers";
import { listCycles, readCycle, writeCustomerGap } from "./store";
import type { Cycle, CustomerGap } from "./types";

const YEAR_MS = 365 * 86_400_000;

/** What the AI answers of one run say about the brand, grouped by attribute. */
export function aiClaimGroups(cycle: Cycle): AiClaimGroup[] {
  const groups = new Map<string, AiClaimGroup>();
  for (const r of cycle.responses) {
    if (!r.analysis?.brandMentioned) continue;
    for (const c of r.analysis.claims) {
      const key = (c.attribute || "General").trim();
      const g = groups.get(key) ?? { attribute: key, positive: 0, negative: 0, neutral: 0, examples: [] };
      g[c.sentiment]++;
      if (g.examples.length < 2 && !g.examples.includes(c.claim)) g.examples.push(c.claim);
      groups.set(key, g);
    }
  }
  return [...groups.values()].sort((a, b) => b.positive + b.negative + b.neutral - (a.positive + a.negative + a.neutral)).slice(0, 30);
}

/**
 * Compares the latest run's AI answers with the last 12 months of the brand's reviews and saves the result. Returns
 * null (and saves nothing, spends nothing) when there are no analysed reviews or no analysed run to compare with.
 */
export async function updateCustomerGap(
  meter: LlmMeter,
  project: Project,
  config: TrackingConfig,
  cycle?: Cycle | null,
): Promise<{ gap: CustomerGap | null; reason?: string }> {
  const voice = await customerVoice(project, new Date(Date.now() - YEAR_MS).toISOString());
  if (voice.totals.analysed === 0) return { gap: null, reason: "No analysed Google Maps reviews yet. Fetch and analyse them in Reviews first." };
  let run = cycle ?? null;
  if (!run) {
    const latest = [...(await listCycles(project.id))].reverse().find((c) => c.done > 0);
    run = latest ? await readCycle(project.id, latest.id) : null;
  }
  if (!run || !run.responses.some((r) => r.analysis)) return { gap: null, reason: "Run a brand check with analysed answers first, so there are AI answers to compare." };
  const { summary, items } = await compareWithCustomers(meter, config.brand, aiClaimGroups(run), voice);
  const gap: CustomerGap = { generatedAt: new Date().toISOString(), cycleId: run.id, reviews: voice.totals.analysed, summary, items };
  await writeCustomerGap(project.id, gap);
  return { gap };
}
