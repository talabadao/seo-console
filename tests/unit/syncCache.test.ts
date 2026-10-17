// Shared cache and durable sync jobs (lib/sync) on the real schema (baseline + every migration, PGlite):
// warm reads make no provider requests, identical cold reads join one job, scopes stay separate, stale results
// are served during outages while one refresh runs, leases recover crashed workers, an old worker can't overwrite
// a newer result, manual refresh joins and cools down, access errors hide data and recover, quota windows and
// Retry-After cool-downs are shared, and jobs recheck project ownership. Cross-process behaviour is measured by the
// capacity harness (scripts/capacity) against a real Postgres server.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { pg } = await vi.hoisted(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  return { pg: new PGlite() };
});

const toPositional = (sql: string) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

vi.mock("@/lib/db", () => ({
  db: {
    prepare: (sql: string) => ({
      get: async (...args: unknown[]) => (await pg.query(toPositional(sql), args)).rows[0],
      all: async (...args: unknown[]) => (await pg.query(toPositional(sql), args)).rows,
      run: async (...args: unknown[]) => {
        const r = await pg.query(toPositional(sql), args);
        return { count: r.affectedRows ?? 0, rows: r.rows };
      },
    }),
  },
  tableExists: async (name: string) => (await pg.query<{ t: string | null }>("SELECT to_regclass($1) AS t", [`public.${name}`])).rows[0].t != null,
  withTransaction: async <T,>(fn: (q: (sql: string, ...args: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>) =>
    pg.transaction(async (tx) => fn(async (sql, ...args) => (await tx.query(toPositional(sql), args)).rows as Record<string, unknown>[])),
}));

import { BASELINE_STATEMENTS } from "@/lib/schema";
import { MIGRATIONS } from "@/db/migrations";
import { MANUAL_COOLDOWN_MS, ACCESS_RETRY_MS, enqueue, enqueueDueRefreshes, readThrough, registerKind, runDueJobs, runJob, setBackgroundRunner } from "@/lib/sync/cache";
import { ProviderBusyError, acquireSlot, providerFetch } from "@/lib/sync/providerHttp";
import { noteProviderRequest, processTotals, resetProcessTotals } from "@/lib/sync/context";
import { syncStatus } from "@/lib/sync/status";

class AccessDenied extends Error {}

/** A fake provider: counts calls, can fail, can be slowed down, returns a value per call. */
const fake = {
  calls: 0,
  mode: "ok" as "ok" | "fail" | "denied" | "busy",
  delayMs: 0,
  value: 1,
  gate: null as Promise<void> | null,
};

registerKind<{ projectId: number; q: string }, { value: number; q: string }>({
  kind: "test:report",
  provider: "fake",
  freshMs: 60 * 60_000,
  async run({ query }) {
    fake.calls++;
    noteProviderRequest("fake");
    if (fake.gate) await fake.gate;
    if (fake.delayMs) await new Promise((r) => setTimeout(r, fake.delayMs));
    if (fake.mode === "fail") throw new Error("provider outage");
    if (fake.mode === "denied") throw new AccessDenied("403 forbidden");
    if (fake.mode === "busy") throw new ProviderBusyError("fake", Date.now() + 60_000, 429);
    return { payload: { value: fake.value, q: query.q }, dataThrough: "2026-10-14" };
  },
  isAccessError: (e) => e instanceof AccessDenied,
});

/** Background work (stale refreshes) is collected so tests can await it. */
let pending: Promise<void>[] = [];
setBackgroundRunner((fn) => {
  pending.push(fn().catch(() => {}));
});
const drain = async () => {
  while (pending.length) {
    const p = pending;
    pending = [];
    await Promise.all(p);
  }
};

const q = (projectId: number, s = "a") => ({ projectId, q: s });
const read = (userId: number, projectId: number, s = "a", extra: { force?: boolean; waitMs?: number } = {}) =>
  readThrough<ReturnType<typeof q>, { value: number; q: string }>({ kind: "test:report", userId, projectId, query: q(projectId, s), waitMs: extra.waitMs ?? 5000, force: extra.force });

const ago = async (ms: number) => {
  // Ages every saved result and job by `ms` (instead of mocking the clock, which PGlite's timers rely on).
  await pg.query("UPDATE report_cache SET fetched_at = fetched_at - $1, fresh_until = fresh_until - $1, last_error_at = last_error_at - $1", [ms]);
  await pg.query("UPDATE sync_jobs SET run_after = run_after - $1, lease_until = lease_until - $1", [ms]);
};

beforeAll(async () => {
  for (const s of BASELINE_STATEMENTS) await pg.exec(s);
  for (const m of MIGRATIONS.slice(1)) for (const s of m.statements) await pg.exec(s);
  await pg.exec(`INSERT INTO users (email, created_at, updated_at) VALUES ('one@example.com', 0, 0), ('two@example.com', 0, 0);
    INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (1, 1, 'One', 0, 0), (2, 1, 'Two', 0, 0), (3, 2, 'Theirs', 0, 0);`);
});

beforeEach(async () => {
  await pg.exec("DELETE FROM sync_jobs; DELETE FROM report_cache; DELETE FROM provider_rate; DELETE FROM provider_cooldown;");
  Object.assign(fake, { calls: 0, mode: "ok", delayMs: 0, value: 1, gate: null });
  pending = [];
  resetProcessTotals();
});
afterEach(drain);

describe("read-through", () => {
  it("a cold read fetches once; warm reads make no provider requests", async () => {
    const first = await read(1, 1);
    expect(first).toMatchObject({ state: "fresh", payload: { value: 1 }, dataThrough: "2026-10-14" });
    for (let i = 0; i < 50; i++) expect((await read(1, 1)).state).toBe("fresh");
    expect(fake.calls).toBe(1);
    const c = (await pg.query<{ hits: number; misses: number }>("SELECT hits::int, misses::int FROM report_cache")).rows[0];
    expect(c.hits).toBe(50);
  });

  it("30 identical concurrent cold reads create one job and one provider request", async () => {
    let open!: () => void;
    fake.gate = new Promise<void>((r) => (open = r));
    const reads = Array.from({ length: 30 }, () => read(1, 1));
    await new Promise((r) => setTimeout(r, 200));
    open();
    const results = await Promise.all(reads);
    expect(results.every((r) => r.state === "fresh" && r.payload?.value === 1)).toBe(true);
    expect(fake.calls).toBe(1);
    expect((await pg.query("SELECT COUNT(*)::int AS n FROM sync_jobs")).rows[0]).toEqual({ n: 1 });
  });

  it("keeps accounts and queries apart", async () => {
    const account = (userId: number) =>
      readThrough<{ q: string }, { value: number }>({ kind: "test:report", userId, projectId: null, query: { q: "account-wide" }, waitMs: 5000 });
    expect((await account(1)).payload?.value).toBe(1);
    fake.value = 2;
    expect((await account(2)).payload?.value).toBe(2); // the same query for another account: its own fetch, never account 1's data
    expect((await account(1)).payload?.value).toBe(1);
    await read(1, 1, "a");
    expect((await read(1, 2, "a")).payload?.value).toBe(2); // another project
    expect((await read(1, 1, "b")).payload?.value).toBe(2); // another query
    expect((await read(1, 1, "a")).payload?.value).toBe(2);
    expect(fake.calls).toBe(5);
  });

  it("serves the last result while stale, refreshes once, and keeps it through an outage", async () => {
    await read(1, 1);
    await ago(2 * 60 * 60_000);
    fake.mode = "fail";
    const stale = await Promise.all(Array.from({ length: 10 }, () => read(1, 1)));
    expect(stale.every((r) => r.state === "stale" && r.payload?.value === 1 && r.refreshing)).toBe(true);
    await drain();
    expect(fake.calls).toBe(2); // ten stale reads, one refresh
    const after = await read(1, 1);
    expect(after).toMatchObject({ state: "stale", payload: { value: 1 }, error: "provider outage" });
    const job = (await pg.query<{ status: string; attempts: number }>("SELECT status, attempts FROM sync_jobs ORDER BY id DESC LIMIT 1")).rows[0];
    expect(job).toEqual({ status: "queued", attempts: 1 }); // backing off, not retrying in a loop
    fake.mode = "ok";
    fake.value = 3;
    await ago(60 * 60_000);
    await runDueJobs({ limit: 5, budgetMs: 5000 });
    expect((await read(1, 1)).payload?.value).toBe(3);
  });

  it("never marks a failed cold read complete, and stops after max attempts", async () => {
    fake.mode = "fail";
    const r = await read(1, 1, "a", { waitMs: 300 });
    expect(r.state).toBe("error");
    expect(r.payload).toBeUndefined();
    for (let i = 0; i < 3; i++) {
      await ago(60 * 60_000);
      await runDueJobs({ limit: 5, budgetMs: 5000 });
    }
    const job = (await pg.query<{ status: string; attempts: number }>("SELECT status, attempts FROM sync_jobs")).rows[0];
    expect(job).toEqual({ status: "failed", attempts: 3 });
    expect((await pg.query("SELECT payload FROM report_cache")).rows[0]).toEqual({ payload: null });
  });
});

describe("leases and generations", () => {
  it("a job whose worker died is picked up after its lease expires", async () => {
    const id = await enqueue({ kind: "test:report", userId: 1, projectId: 1, query: q(1), reason: "cold" });
    // A worker claims it and dies (simulated: the lease is taken but never completed).
    await pg.query("UPDATE sync_jobs SET status = 'running', lease_token = 'dead', lease_until = $1, attempts = 1 WHERE id = $2", [Date.now() + 60_000, id]);
    expect(await runJob(id)).toBe("not-claimed");
    await ago(2 * 60_000);
    expect(await runDueJobs({ limit: 5, budgetMs: 5000 })).toMatchObject({ outcomes: { done: 1 } });
    expect((await read(1, 1)).payload?.value).toBe(1);
  });

  it("a worker that lost its lease can't complete, and an older job never overwrites a newer result", async () => {
    const id = await enqueue({ kind: "test:report", userId: 1, projectId: 1, query: q(1), reason: "cold" });
    let open!: () => void;
    fake.gate = new Promise<void>((r) => (open = r));
    fake.value = 10;
    const slow = runJob(id, 50); // short lease
    await new Promise((r) => setTimeout(r, 120));
    fake.gate = null;
    fake.value = 20;
    expect(await runJob(id)).toBe("done"); // another worker takes over the expired lease
    open();
    expect(await slow).toBe("lost-lease");
    expect((await read(1, 1)).payload?.value).toBe(20);

    // An older job's result (lower generation) is ignored.
    await pg.query("UPDATE report_cache SET generation = generation + 1000");
    await ago(MANUAL_COOLDOWN_MS + 1000); // past the manual cooldown, so the older job does run
    const older = await enqueue({ kind: "test:report", userId: 1, projectId: 1, query: q(1), reason: "manual" });
    fake.value = 30;
    expect(await runJob(older)).toBe("done");
    expect((await read(1, 1)).payload?.value).toBe(20);
  });
});

describe("late joiners", () => {
  it("a job queued by a reader that saw the old result skips the provider once the result is fresh", async () => {
    await read(1, 1);
    await ago(2 * 60 * 60_000);
    await read(1, 1); // stale: one refresh
    await drain();
    expect(fake.calls).toBe(2);
    // A reader that loaded the stale row just before that refresh finished queues another job.
    const late = await enqueue({ kind: "test:report", userId: 1, projectId: 1, query: q(1), reason: "stale" });
    expect(await runJob(late)).toBe("skipped");
    const cold = await enqueue({ kind: "test:report", userId: 1, projectId: 1, query: q(1), reason: "cold" });
    expect(await runJob(cold)).toBe("skipped");
    expect(fake.calls).toBe(2);
  });

  it("runs due jobs concurrently without running any twice", async () => {
    for (let i = 0; i < 12; i++) await enqueue({ kind: "test:report", userId: 1, projectId: 1, query: q(1, "k" + i), reason: "schedule" });
    fake.delayMs = 30;
    const r = await Promise.all([runDueJobs({ limit: 50, budgetMs: 5000, concurrency: 4 }), runDueJobs({ limit: 50, budgetMs: 5000, concurrency: 4 })]);
    expect(r[0].ran + r[1].ran - (r[0].outcomes["not-claimed"] ?? 0) - (r[1].outcomes["not-claimed"] ?? 0)).toBe(12);
    expect(fake.calls).toBe(12);
  });
});

describe("manual refresh", () => {
  it("spam joins one job and respects the cooldown", async () => {
    await read(1, 1);
    const spam = await Promise.all(Array.from({ length: 20 }, () => read(1, 1, "a", { force: true })));
    expect(spam.every((r) => r.cooldown && r.state === "fresh")).toBe(true);
    expect(fake.calls).toBe(1);
    await ago(MANUAL_COOLDOWN_MS + 1000);
    let open!: () => void;
    fake.gate = new Promise<void>((r) => (open = r));
    const forced = Promise.all(Array.from({ length: 20 }, () => read(1, 1, "a", { force: true, waitMs: 2000 })));
    await new Promise((r) => setTimeout(r, 100));
    open();
    await forced;
    await drain();
    expect(fake.calls).toBe(2);
  });
});

describe("authorization", () => {
  it("another account's project is never fetched or served", async () => {
    await read(1, 1);
    const r = await read(2, 1);
    expect(r.state).toBe("error");
    expect(r.payload).toBeUndefined();
    expect(fake.calls).toBe(1);
  });

  it("an access error hides the saved result and recovers after reconnecting", async () => {
    await read(1, 1);
    await ago(2 * 60 * 60_000);
    fake.mode = "denied";
    await read(1, 1);
    await drain();
    const denied = await read(1, 1);
    expect(denied).toMatchObject({ state: "error", error: "403 forbidden" });
    expect(denied.payload).toBeUndefined();
    expect(fake.calls).toBe(2);
    await read(1, 1);
    await drain();
    expect(fake.calls).toBe(2); // no retry storm while access is missing
    fake.mode = "ok";
    fake.value = 5;
    await ago(ACCESS_RETRY_MS + 1000);
    await read(1, 1);
    await drain();
    expect(await read(1, 1)).toMatchObject({ state: "fresh", payload: { value: 5 } });
  });

  it("a job for a project the account no longer owns fails and clears the data", async () => {
    await read(1, 2);
    await pg.query("UPDATE projects SET user_id = 2 WHERE id = 2");
    try {
      const id = await enqueue({ kind: "test:report", userId: 1, projectId: 2, query: q(2), reason: "manual" });
      expect(await runJob(id)).toBe("failed");
      expect((await read(1, 2)).state).toBe("error");
      expect(fake.calls).toBe(1);
    } finally {
      await pg.query("UPDATE projects SET user_id = 1 WHERE id = 2");
    }
  });
});

describe("provider limits", () => {
  it("a rate-limited job is requeued for later without using an attempt", async () => {
    fake.mode = "busy";
    const r = await read(1, 1, "a", { waitMs: 300 });
    expect(r.state).toBe("error");
    const job = (await pg.query<{ status: string; attempts: number; run_after: string }>("SELECT status, attempts, run_after FROM sync_jobs")).rows[0];
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0);
    expect(Number(job.run_after)).toBeGreaterThan(Date.now() + 30_000);
  });

  it("a quota window is shared by every caller of the same credential", async () => {
    const limit = { max: 5, windowMs: 60_000 };
    for (let i = 0; i < 5; i++) await acquireSlot("seranking:key:abc", limit, 0);
    await expect(acquireSlot("seranking:key:abc", limit, 0)).rejects.toBeInstanceOf(ProviderBusyError);
    await acquireSlot("seranking:key:other", limit, 0); // another key has its own quota
  });

  it("a 429 with Retry-After sets a shared cool-down instead of retrying in a storm", async () => {
    const fetchMock = vi.fn(async () => new Response("slow down", { status: 429, headers: { "Retry-After": "120" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const req = { provider: "fake", bucket: "fake:key:1", limit: { max: 100, windowMs: 1000 }, url: "https://example.invalid/x" };
      await expect(providerFetch(req)).rejects.toBeInstanceOf(ProviderBusyError);
      await expect(providerFetch(req)).rejects.toBeInstanceOf(ProviderBusyError); // waits on the cool-down
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(processTotals.providerRequests).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a write that timed out is not sent again", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("timeout");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(providerFetch({ provider: "fake", bucket: "fake:key:2", limit: { max: 100, windowMs: 1000 }, url: "https://example.invalid/w", init: { method: "POST" } })).rejects.toThrow("timeout");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("scheduled refresh and status", () => {
  it("queues only recently read stale results, once, and reports status from local records", async () => {
    await read(1, 1, "a");
    await read(1, 1, "b");
    await ago(2 * 60 * 60_000);
    await pg.query("UPDATE report_cache SET last_read_at = 0 WHERE query->>'q' = 'b'"); // nobody looked at it for long
    expect(await enqueueDueRefreshes({ activeSinceMs: 7 * 24 * 3600_000, limit: 50 })).toBe(1);
    expect(await enqueueDueRefreshes({ activeSinceMs: 7 * 24 * 3600_000, limit: 50 })).toBe(0);
    const status = await syncStatus(1);
    expect(status.jobs.queued).toBe(1);
    expect(status.entries).toHaveLength(2);
    expect(status.byProvider[0]).toMatchObject({ provider: "fake", providerRequests: 2 });
    expect((await syncStatus(2)).entries).toHaveLength(0);
  });
});
