// Capacity harness for the shared cache and durable sync jobs (controlled test, not a live measurement).
//
//   cd scripts/capacity && npm install        # once: embedded-postgres (a real Postgres server, local only)
//   npx tsx scripts/capacity/run.ts           # from the repository root
//
// Starts a throwaway Postgres 18 server, applies the app's real baseline schema and every migration, seeds 5
// accounts with 80 projects (16 each), then runs 30 concurrent browsing sessions spread over 4 Node processes
// ("server instances", each with the app's own 5-connection pool). Providers are fakes (scripts/capacity/
// fakeKinds.ts): realistic latency and payload size, the real shared rate windows, no network — every
// non-local request is blocked, and no provider credentials are passed to the processes. Writes
// scripts/capacity/results.json and prints a Markdown summary.

import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { Session, ViewResult } from "./worker";

const INSTANCES = 4;
const SESSIONS = 30;
const USERS = 5;
const PROJECTS = 80;
const PORT = 54329;
const ALLOWED = ["analytics@headsonpillows.com", "analytics@artemisdigital.com", "tinledoihoa@gmail.com", "tin@headsonpillows.com", "tin@artemisdigital.com"];

const dataDir = mkdtempSync(join(tmpdir(), "seo-capacity-"));
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: "cap", password: "cap", port: PORT, persistent: false, onLog: () => {} });
// Local server without TLS (the app requires TLS unless the URL says otherwise).
const DATABASE_URL = `postgres://cap:cap@127.0.0.1:${PORT}/capacity?sslmode=disable`;

// Only what the processes need: no provider keys, no Vercel variables (so: development, migrations apply).
const childEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, DATABASE_URL, NODE_ENV: "production" };

const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const projectsOf = (userId: number) => Array.from({ length: PROJECTS }, (_, i) => i + 1).filter((p) => ((p - 1) % USERS) + 1 === userId);
/** Skewed choice: a few projects are opened much more often than the rest. */
const pick = (list: number[]) => list[Math.floor(list.length * rand() ** 2)];

async function main() {
  await server.initialise();
  await server.start();
  await server.createDatabase("capacity");
  for (const [k, v] of Object.entries(childEnv)) if (v !== undefined) process.env[k] = v;
  for (const k of Object.keys(process.env)) if (/SERPAPI|SERANKING|OPENAI|ANTHROPIC|DATAFORSEO|GOOGLE_CLIENT|ASANA|VERCEL/i.test(k)) delete process.env[k];
  const { db } = await import("@/lib/db");
  // First access applies the baseline schema and every versioned migration (development).
  await db.prepare("SELECT 1").get();
  const now = Date.now();
  for (const email of ALLOWED) await db.prepare("INSERT INTO users (email, created_at, updated_at) VALUES (?, ?, ?)").run(email, now, now);
  for (let p = 1; p <= PROJECTS; p++) {
    await db.prepare("INSERT INTO projects (id, user_id, name, website_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(p, ((p - 1) % USERS) + 1, `Project ${p}`, `https://project${p}.example/`, now, now);
  }
  await db.prepare("CREATE TABLE cap_calls (id BIGSERIAL PRIMARY KEY, at BIGINT, kind TEXT, bucket TEXT, project_id BIGINT, pid INT, ok BOOLEAN)").run();
  await db.prepare("CREATE TABLE cap_mode (id INT PRIMARY KEY, mode TEXT)").run();
  await db.prepare("INSERT INTO cap_mode VALUES (1, 'ok')").run();

  const workers: ChildProcess[] = [];
  await Promise.all(
    Array.from({ length: INSTANCES }, () => {
      const w = fork(join(import.meta.dirname, "worker.ts"), [], { execArgv: ["--import", "tsx"], env: childEnv, cwd: process.cwd(), stdio: ["inherit", "inherit", "inherit", "ipc"] });
      workers.push(w);
      return new Promise<void>((res) => w.once("message", () => res()));
    }),
  );

  const count = async (sql: string, ...args: unknown[]) => Number(((await db.prepare(sql).get(...args)) as { n: number }).n);
  const totals = async () => ({
    calls: await count("SELECT COUNT(*)::int AS n FROM cap_calls"),
    jobs: await count("SELECT COUNT(*)::int AS n FROM sync_jobs"),
    hits: await count("SELECT COALESCE(SUM(hits), 0)::int AS n FROM report_cache"),
    misses: await count("SELECT COALESCE(SUM(misses), 0)::int AS n FROM report_cache"),
    failedJobs: await count("SELECT COUNT(*)::int AS n FROM sync_jobs WHERE status = 'failed'"),
  });

  async function phase(name: string, sessions: Session[], note: string) {
    const before = await totals();
    const t0 = Date.now();
    const startAt = Date.now() + 300;
    const parts = workers.map((w, i) => {
      const mine = sessions.filter((_, j) => j % INSTANCES === i);
      return new Promise<ViewResult[]>((res) => {
        w.once("message", (m: { results: ViewResult[] }) => res(m.results));
        w.send({ type: "run", sessions: mine, startAt });
      });
    });
    const results = (await Promise.all(parts)).flat();
    const after = await totals();
    const reads = results.flatMap((r) => r.reads);
    const states: Record<string, number> = {};
    for (const r of reads) states[r.state] = (states[r.state] ?? 0) + 1;
    const keys = new Set(sessions.flatMap((s) => s.views.map((v) => `${s.userId}:${v.projectId}:${v.config ?? "v1"}`))).size * 6;
    const calls = after.calls - before.calls;
    const errors = reads.filter((r) => r.state === "error" || r.state === "pending").length;
    const out = {
      phase: name,
      note,
      sessions: sessions.length,
      instances: INSTANCES,
      pageViews: results.length,
      reads: reads.length,
      distinctKeys: keys,
      wallMs: Date.now() - t0,
      pageMs: { p50: pct(results.map((r) => r.ms), 50), p95: pct(results.map((r) => r.ms), 95), max: pct(results.map((r) => r.ms), 100) },
      readMs: { p50: pct(reads.map((r) => r.ms), 50), p95: pct(reads.map((r) => r.ms), 95) },
      states,
      errorRate: reads.length ? Math.round((errors / reads.length) * 10000) / 100 : 0,
      providerRequests: calls,
      jobsCreated: after.jobs - before.jobs,
      failedJobs: after.failedJobs - before.failedJobs,
      readsPerProviderRequest: calls ? Math.round((reads.length / calls) * 10) / 10 : null,
      cacheHitRatio: after.hits - before.hits + (after.misses - before.misses) ? Math.round(((after.hits - before.hits) / (after.hits - before.hits + (after.misses - before.misses))) * 1000) / 10 : null,
    };
    console.log(`${name}: ${JSON.stringify(out)}`);
    return out;
  }

  const browse = (views: number, think: [number, number], config = "v1", userOf = (i: number) => (i % USERS) + 1): Session[] => {
    return Array.from({ length: SESSIONS }, (_, i) => {
      const userId = userOf(i);
      return { id: i, userId, views: Array.from({ length: views }, () => ({ projectId: pick(projectsOf(userId)), config })), thinkMs: think };
    });
  };

  const report: unknown[] = [];

  // 1. Thirty identical cold reads across 4 processes: one job and one provider request per section.
  report.push(
    await phase(
      "cold-identical",
      Array.from({ length: SESSIONS }, (_, i) => ({ id: i, userId: 1, views: [{ projectId: 1 }], thinkMs: [0, 0] as [number, number] })),
      "30 sessions, same account and project, started together on 4 instances (6 sections each)",
    ),
  );

  // 2. Thirty sessions browsing 80 projects (5 accounts × 16), cold cache.
  seed = 7;
  const sessions = browse(12, [100, 400]);
  report.push(await phase("browse-cold", sessions, "30 sessions × 12 page views over their account's 16 projects, cold cache"));

  // 3. The same browsing again: everything is fresh, so no provider requests.
  report.push(await phase("browse-warm", sessions, "same views again, all results fresh"));

  // 4. Everything stale: served immediately from the last result, one background refresh per result.
  await db.prepare("UPDATE report_cache SET fresh_until = 1").run();
  report.push(await phase("stale", sessions, "all saved results past their refresh time"));

  // 5. Provider outage while stale: the last results are still served; one failed attempt per result, then backoff.
  await db.prepare("UPDATE report_cache SET fresh_until = 1").run();
  await db.prepare("UPDATE cap_mode SET mode = 'fail'").run();
  report.push(await phase("outage", sessions, "stale results while every provider request fails"));
  await db.prepare("UPDATE cap_mode SET mode = 'ok'").run();
  // Let the backoff pass and recover through the durable queue (as the scheduler would).
  await db.prepare("UPDATE sync_jobs SET run_after = 0 WHERE status = 'queued'").run();
  const { runDueJobs } = await import("@/lib/sync/cache");
  await import("./fakeKinds").then((m) => m.registerFakeKinds());
  const recovery = await runDueJobs({ limit: 1000, budgetMs: 120_000 });
  console.log(`recovery: ${JSON.stringify(recovery)}`);

  // 6. Quota: one account opens all 16 of its projects at once with a new configuration (96 cold sections),
  //    through 6 per-credential buckets of 10 requests/second shared by all instances.
  seed = 11;
  const quotaStart = Date.now();
  report.push(await phase("quota", browse(3, [0, 0], "v2", () => 3), "30 sessions of one account, 3 views each, new configuration (cold)"));
  const perSecond = (await db
    .prepare("SELECT bucket, (at / 1000) AS sec, COUNT(*)::int AS n FROM cap_calls WHERE at >= ? GROUP BY bucket, sec ORDER BY n DESC LIMIT 1")
    .get(quotaStart)) as { bucket: string; n: number } | undefined;
  const calls = (await db.prepare("SELECT bucket, at FROM cap_calls WHERE at >= ? ORDER BY bucket, at").all(quotaStart)) as Array<{ bucket: string; at: number }>;
  let slidingMax = 0;
  for (let i = 0; i < calls.length; i++) {
    let j = i;
    while (j < calls.length && calls[j].bucket === calls[i].bucket && Number(calls[j].at) - Number(calls[i].at) < 1000) j++;
    slidingMax = Math.max(slidingMax, j - i);
  }
  const quota = { limitPerSecondPerCredential: 10, maxInOneCalendarSecond: perSecond?.n ?? 0, maxInAnySliding1s: slidingMax, note: "fixed 1 s windows: any sliding second can hold at most 2 × the limit" };
  console.log(`quota: ${JSON.stringify(quota)}`);

  // 7. Refresh spam: 30 sessions press Refresh on the same fresh page: cooldown, no requests. After the cooldown,
  //    30 more presses join one refresh per section.
  const spam = () => Array.from({ length: SESSIONS }, (_, i) => ({ id: i, userId: 1, views: [{ projectId: 1, force: true }], thinkMs: [0, 0] as [number, number] }));
  report.push(await phase("refresh-spam-cooldown", spam(), "30 concurrent manual refreshes of a page fetched minutes ago"));
  await db.prepare("UPDATE report_cache SET fetched_at = fetched_at - 600000 WHERE user_id = 1 AND project_id = 1").run();
  report.push(await phase("refresh-spam-after-cooldown", spam(), "30 concurrent manual refreshes after the 5-minute cooldown"));

  const pool = { instances: INSTANCES, connectionsPerInstance: 5, postgres: "embedded-postgres 18 (local)" };
  writeFileSync(join(import.meta.dirname, "results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), kind: "controlled", pool, phases: report, recovery, quota }, null, 2));

  for (const w of workers) w.send({ type: "exit" });
  await db.prepare("SELECT 1").get();
  process.exitCode = 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await server.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
    process.exit();
  });
