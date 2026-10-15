// Brand Mentions data per SEO Console project (ai_documents), adapted from the AI Brand Mention app's Blob files:
// prompts, settings, the list of cycles, one document per cycle with every answer, fact verdicts and the
// customer-review comparison. Callers check project ownership first (API routes).
import { deleteDoc, readDoc, writeDoc } from "@/lib/ai-area/store";
import { DEFAULT_CHATGPT_MODEL, DEFAULT_CLAUDE_MODEL } from "./pricing";
import type { BrandPrompt, BrandSettings, CustomerGap, Cycle, CycleSummary, FactVerdict } from "./types";

const KIND = "brand";
const CYCLE = "brand-cycle";

export const MAX_PROMPTS = 200;

/**
 * Google AI Mode and AI Overview are on by default (SerpApi, capped per project). ChatGPT and Claude are off until
 * someone turns them on, since each answer is a paid model call.
 */
export function defaultSettings(): BrandSettings {
  return {
    platforms: { aiMode: true, aiOverview: true, chatgpt: false, claude: false },
    chatgptModel: DEFAULT_CHATGPT_MODEL,
    claudeModel: DEFAULT_CLAUDE_MODEL,
  };
}

export async function readPrompts(projectId: number): Promise<BrandPrompt[]> {
  return (await readDoc<{ prompts: BrandPrompt[] }>(projectId, KIND, "prompts"))?.prompts ?? [];
}

export async function writePrompts(projectId: number, prompts: BrandPrompt[]): Promise<void> {
  await writeDoc(projectId, KIND, "prompts", { prompts: prompts.slice(0, MAX_PROMPTS) });
}

export async function readSettings(projectId: number): Promise<BrandSettings> {
  const saved = await readDoc<Partial<BrandSettings>>(projectId, KIND, "settings");
  const d = defaultSettings();
  return {
    platforms: { ...d.platforms, ...(saved?.platforms ?? {}) },
    chatgptModel: saved?.chatgptModel ?? d.chatgptModel,
    claudeModel: saved?.claudeModel ?? d.claudeModel,
  };
}

export async function writeSettings(projectId: number, settings: BrandSettings): Promise<void> {
  await writeDoc(projectId, KIND, "settings", settings);
}

export async function listCycles(projectId: number): Promise<CycleSummary[]> {
  return (await readDoc<{ cycles: CycleSummary[] }>(projectId, KIND, "cycles"))?.cycles ?? [];
}

export async function writeCycles(projectId: number, cycles: CycleSummary[]): Promise<void> {
  await writeDoc(projectId, KIND, "cycles", { cycles });
}

export async function updateCycleSummary(projectId: number, id: string, patch: Partial<CycleSummary>): Promise<CycleSummary | null> {
  const cycles = await listCycles(projectId);
  const index = cycles.findIndex((c) => c.id === id);
  if (index < 0) return null;
  cycles[index] = { ...cycles[index], ...patch };
  await writeCycles(projectId, cycles);
  return cycles[index];
}

export async function readCycle(projectId: number, id: string): Promise<Cycle | null> {
  if (!/^[\w-]{1,60}$/.test(id)) return null;
  return readDoc<Cycle>(projectId, CYCLE, id);
}

export async function writeCycle(projectId: number, cycle: Cycle): Promise<void> {
  await writeDoc(projectId, CYCLE, cycle.id, cycle);
}

export async function deleteCycle(projectId: number, id: string): Promise<void> {
  await writeCycles(projectId, (await listCycles(projectId)).filter((c) => c.id !== id));
  await deleteDoc(projectId, CYCLE, id);
}

export async function readFacts(projectId: number): Promise<Record<string, FactVerdict>> {
  return (await readDoc<{ verdicts: Record<string, FactVerdict> }>(projectId, KIND, "facts"))?.verdicts ?? {};
}

export async function setFact(projectId: number, key: string, verdict: FactVerdict | null): Promise<Record<string, FactVerdict>> {
  const verdicts = await readFacts(projectId);
  if (verdict) verdicts[key] = verdict;
  else delete verdicts[key];
  await writeDoc(projectId, KIND, "facts", { verdicts });
  return verdicts;
}

/** Stable key for a fact statement, so a verdict survives re-runs that repeat the same claim. */
export function factKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 120);
}

export async function readCustomerGap(projectId: number): Promise<CustomerGap | null> {
  return readDoc<CustomerGap>(projectId, KIND, "customer-gap");
}

export async function writeCustomerGap(projectId: number, gap: CustomerGap): Promise<void> {
  await writeDoc(projectId, KIND, "customer-gap", gap);
}
