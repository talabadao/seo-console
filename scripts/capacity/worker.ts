// One simulated server instance for the capacity harness: its own Node process and its own connection pool (the
// app's lib/db, max 5 connections), running browsing sessions the orchestrator assigns and reporting latencies.
// Background refreshes (after() in route handlers) are collected and awaited before each report.

import { readThrough, setBackgroundRunner } from "@/lib/sync/cache";
import { PARTS, registerFakeKinds, type CapQuery } from "./fakeKinds";

// No real provider can be reached from here: any non-local request fails loudly.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) throw new Error(`capacity harness: blocked network request to ${url}`);
  return realFetch(input, init);
}) as typeof fetch;

registerFakeKinds();
let background: Promise<void>[] = [];
setBackgroundRunner((fn) => {
  background.push(fn().catch(() => {}));
});

export interface Session {
  id: number;
  userId: number;
  /** Page views: each reads all summary parts of one project, like the dashboard. */
  views: Array<{ projectId: number; force?: boolean; config?: string }>;
  thinkMs: [number, number];
}
export interface ViewResult {
  session: number;
  ms: number;
  reads: Array<{ ms: number; state: string }>;
}

const period = { start: "2026-09-16", end: "2026-10-13" };

async function view(session: Session, projectId: number, force: boolean, config = "v1"): Promise<ViewResult> {
  const t0 = performance.now();
  const reads = await Promise.all(
    PARTS.map(async (part) => {
      const r0 = performance.now();
      const query: CapQuery = { projectId, part, period, detail: true, config };
      const r = await readThrough({ kind: `cap:${part}`, userId: session.userId, projectId, query, waitMs: 15_000, force });
      return { ms: performance.now() - r0, state: r.state + (r.cooldown ? ":cooldown" : "") };
    }),
  );
  return { session: session.id, ms: performance.now() - t0, reads };
}

async function runSession(s: Session): Promise<ViewResult[]> {
  const out: ViewResult[] = [];
  for (const v of s.views) {
    out.push(await view(s, v.projectId, Boolean(v.force), v.config));
    const [a, b] = s.thinkMs;
    if (b > 0) await new Promise((r) => setTimeout(r, a + Math.random() * (b - a)));
  }
  return out;
}

process.on("message", async (msg: { type: string; sessions?: Session[]; startAt?: number }) => {
  if (msg.type === "run") {
    // Start together with the other instances.
    if (msg.startAt) await new Promise((r) => setTimeout(r, Math.max(0, msg.startAt! - Date.now())));
    const results = (await Promise.all((msg.sessions ?? []).map(runSession))).flat();
    const pending = background;
    background = [];
    await Promise.all(pending);
    process.send!({ type: "done", results });
  }
  if (msg.type === "exit") process.exit(0);
});
process.send!({ type: "ready" });
