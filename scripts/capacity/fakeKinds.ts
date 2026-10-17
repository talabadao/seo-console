// Fake providers for the capacity harness. They register sync kinds with the real shared cache (lib/sync/cache.ts)
// and the real shared rate windows (lib/sync/providerHttp.ts acquireSlot), but never touch the network: each
// "provider request" sleeps for a realistic latency, is recorded in cap_calls (so every process's calls are
// counted in one place) and returns a payload shaped and sized like a real summary section.
// The provider's behaviour (ok / failing) comes from cap_mode so the orchestrator can switch it for every
// process at once.

import { db } from "@/lib/db";
import { registerKind } from "@/lib/sync/cache";
import { acquireSlot } from "@/lib/sync/providerHttp";
import { noteProviderRequest } from "@/lib/sync/context";

export const PARTS = ["gsc", "ga4", "kpi", "tasks", "health", "rankings"] as const;
export type Part = (typeof PARTS)[number];

/** Requests per second each fake credential allows (the real SE Ranking key limit is 5/s; GSC/GA4 10/s). */
export const CREDENTIAL_LIMIT = { max: 10, windowMs: 1000 };

export interface CapQuery {
  projectId: number;
  part: Part;
  period: { start: string; end: string };
  detail: boolean;
  config: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Typical provider latency: 150–450 ms, a few slower ones. */
const latency = () => 150 + Math.random() * 300 + (Math.random() < 0.05 ? 800 : 0);

function payload(q: CapQuery) {
  // ~28 daily points plus top/up/down lists of 10 pages and 10 queries: about the size of a detail summary.
  const series = Array.from({ length: 28 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, clicks: Math.round(Math.random() * 500), impressions: Math.round(Math.random() * 20000) }));
  const list = (prefix: string) =>
    ["top", "up", "down"].map(() => Array.from({ length: 10 }, (_, i) => ({ key: `https://project${q.projectId}.example/${prefix}/${i}`, clicks: Math.round(Math.random() * 300), previousClicks: Math.round(Math.random() * 300) })));
  return { state: "live", source: `fake ${q.part}`, dataThrough: q.period.end, fetchedAt: Date.now(), data: { series, pages: list("page"), queries: list("q") } };
}

let registered = false;
export function registerFakeKinds(): void {
  if (registered) return;
  registered = true;
  for (const part of PARTS) {
    registerKind<CapQuery, unknown>({
      kind: `cap:${part}`,
      provider: `fake-${part}`,
      freshMs: 6 * 3600_000,
      async run({ userId, query }) {
        // One shared quota per credential: here, one credential per account and provider family.
        const bucket = `fake:cred:${userId}:${part === "kpi" ? "ga4" : part}`;
        await acquireSlot(bucket, CREDENTIAL_LIMIT, 30_000);
        noteProviderRequest(`fake-${part}`);
        const mode = (await db.prepare("SELECT mode FROM cap_mode WHERE id = 1").get()) as { mode: string } | undefined;
        await db.prepare("INSERT INTO cap_calls (at, kind, bucket, project_id, pid, ok) VALUES (?, ?, ?, ?, ?, ?)").run(Date.now(), part, bucket, query.projectId, process.pid, mode?.mode !== "fail");
        await sleep(latency());
        if (mode?.mode === "fail") throw new Error("fake provider outage (HTTP 503)");
        return { payload: payload(query), dataThrough: query.period.end };
      },
    });
  }
}
