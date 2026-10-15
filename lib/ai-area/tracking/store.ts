// Google Search Tracking data per SEO Console project (ai_documents). Adapted from the AI Brand Mention app's
// Blob store: one config document and one history document per keyword. The donor's own project list is gone —
// the AI Area always works on the SEO Console project the user opened. The same data serves
// Rank tracking → Google, so there is one set of runs and one set of charges.

import { listDocs, readDoc, writeDoc } from "@/lib/ai-area/store";
import { RESULT_DEPTHS, type KeywordHistory, type TrackingConfig } from "./types";

const CONFIG = "tracking-config";
const HISTORY = "tracking-history";

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A starting config for a project: its name and website as the brand, no keywords yet. */
export function defaultConfig(project: { name: string; websiteUrl: string }): TrackingConfig {
  return {
    settings: { language: "en", country: "us", device: "mobile", resultDepth: 10 },
    keywords: [],
    brand: { name: project.name.replace(/\s*\(demo\)$/i, ""), aliases: [], website: hostOf(project.websiteUrl) },
    competitors: [],
    excludedDomains: [],
  };
}

export async function readConfig(project: { id: number; name: string; websiteUrl: string }): Promise<TrackingConfig> {
  const saved = await readDoc<TrackingConfig>(project.id, CONFIG, "config");
  const defaults = defaultConfig(project);
  if (!saved) return defaults;
  const settings = { ...defaults.settings, ...saved.settings };
  if (!RESULT_DEPTHS.includes(settings.resultDepth)) settings.resultDepth = defaults.settings.resultDepth;
  return { ...defaults, ...saved, settings };
}

export async function writeConfig(projectId: number, config: TrackingConfig): Promise<void> {
  await writeDoc(projectId, CONFIG, "config", config);
}

export async function readHistory(projectId: number, keywordId: string): Promise<KeywordHistory | null> {
  return readDoc<KeywordHistory>(projectId, HISTORY, keywordId);
}

export async function writeHistory(projectId: number, history: KeywordHistory): Promise<void> {
  await writeDoc(projectId, HISTORY, history.keywordId, history);
}

/** Every keyword's history, trimmed to days on or after `since` (YYYY-MM-DD). */
export async function readHistories(projectId: number, config: TrackingConfig, since: string | null): Promise<KeywordHistory[]> {
  const docs = new Map((await listDocs<KeywordHistory>(projectId, HISTORY)).map((d) => [d.key, d.data]));
  return config.keywords.map((kw) => {
    const h = docs.get(kw.id) ?? { keywordId: kw.id, keyword: kw.keyword, days: [] };
    return since ? { ...h, days: h.days.filter((d) => d.date >= since) } : h;
  });
}
