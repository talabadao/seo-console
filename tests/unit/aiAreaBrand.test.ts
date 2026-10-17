// Brand Mentions runs against a real Postgres engine (PGlite) with SerpApi stubbed: the Preview policy (one project,
// 5 requests in total, no model calls), partial results kept when the cap stops a run, and no refill on resume.
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
}));

import { migration as aiArea } from "@/db/migrations/0003_ai_area";
import type { Project } from "@/lib/projects";
import type { UserRow } from "@/lib/session";
import { beginBrandRun, continueBrandRun, previewBrandRun } from "@/lib/ai-area/brand/run";
import { listCycles, readCycle, writePrompts } from "@/lib/ai-area/brand/store";
import { buildDashboard } from "@/lib/ai-area/brand/dashboard";
import { readConfig } from "@/lib/ai-area/tracking/store";

const user = { id: 1 } as UserRow;
const project = { id: 1, name: "WeWine", websiteUrl: "https://wewine.vn/", gbpLocation: null, gbpLocationTitle: null } as unknown as Project;
const other = { ...project, id: 2, name: "Other" } as Project;

const fetchMock = vi.fn(async (input: string | URL) => {
  const engine = new URL(String(input)).searchParams.get("engine");
  const body =
    engine === "google_ai_mode"
      ? { text_blocks: [{ snippet: "WeWine is a wine shop in Ho Chi Minh City." }], references: [{ title: "WeWine", link: "https://wewine.vn/" }] }
      : engine === "google"
        ? { ai_overview: { page_token: "tok" } }
        : { ai_overview: { text_blocks: [{ snippet: "Other shops are popular too." }], references: [] } };
  return new Response(JSON.stringify(body), { status: 200 });
});

beforeAll(async () => {
  // Both projects belong to account 1 and still carry a legacy project key, which the resolver uses.
  await pg.exec(`CREATE TABLE users (id BIGSERIAL PRIMARY KEY, email TEXT); CREATE TABLE projects (id BIGSERIAL PRIMARY KEY, user_id BIGINT, serpapi_key TEXT, serpapi_key_updated_at BIGINT);
    INSERT INTO users (email) VALUES ('owner@example.com'); INSERT INTO projects (user_id, serpapi_key) VALUES (1, 'test-key-not-real'), (1, 'test-key-not-real');`);
  for (const s of aiArea.statements) await pg.exec(s);
});

beforeEach(async () => {
  await pg.exec("DELETE FROM provider_usage; DELETE FROM provider_allowances; DELETE FROM ai_runs; DELETE FROM ai_documents;");
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PREVIEW_SERPAPI_TEST_PROJECT_ID", "1");
  vi.stubEnv("OPENAI_API_KEY", "sk-test-not-real");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-not-real");
  const at = "2026-10-16T00:00:00.000Z";
  await writePrompts(1, [
    { id: "p1", text: "best wine shop in Saigon", topic: "Best for", branded: false, source: "manual", active: true, createdAt: at },
    { id: "p2", text: "is WeWine worth it", topic: "Worth it?", branded: true, source: "manual", active: true, createdAt: at },
    { id: "p3", text: "WeWine vs other shops", topic: "Comparisons", branded: true, source: "manual", active: true, createdAt: at },
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function runToEnd() {
  const { runId, estimate } = await beginBrandRun(user, project);
  let step = await continueBrandRun(user, project, runId);
  for (let i = 0; i < 5 && !step.finished; i++) step = await continueBrandRun(user, project, runId);
  return { estimate, step };
}

describe("Brand Mentions on Preview", () => {
  it("plans only the Google sources; ChatGPT and Claude are unavailable, not faked", async () => {
    const est = await previewBrandRun(user, project);
    expect(est.platforms).toEqual(["aiMode", "aiOverview"]);
    expect(est.answers).toBe(6);
    expect(est.serpRequests).toEqual({ min: 6, max: 9 });
    // Off by default; when turned on they're listed as unavailable with the reason.
    expect(est.unavailable).toEqual({});
  });

  it("stops at the 5-request allowance, keeps what was fetched and stores answers unanalysed", async () => {
    const { step } = await runToEnd();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(step.status).toBe("stopped");
    expect(step.actual.serpRequests).toBe(5);
    const [summary] = await listCycles(1);
    expect(summary.status).toBe("stopped");
    const cycle = (await readCycle(1, summary.id))!;
    expect(cycle.responses.map((r) => `${r.promptId}:${r.platform}:${r.serpCredits}`)).toEqual(["p1:aiMode:1", "p1:aiOverview:2", "p2:aiMode:1", "p2:aiOverview:1"]);
    // The refused AI Overview second request: the first one cost a request, so the answer is kept with the reason.
    expect(cycle.responses[3].error).toMatch(/5 of 5 used/);
    for (const r of cycle.responses.filter((x) => x.present)) {
      expect(r.analysis).toBeUndefined();
      expect(r.analysisError).toMatch(/switched off on Preview/);
    }
    // Literal brand mentions are still counted from the real text.
    const dash = buildDashboard([summary], [cycle], await readConfig(project), { platform: "all", promptType: "all", topic: "all" }, {});
    expect(dash.answers).toMatchObject({ collected: 3, unanalysed: 3, literal: 2, present: 0 });
  });

  it("doesn't refill on resume: continuing the same cycle sends nothing more", async () => {
    await runToEnd();
    fetchMock.mockClear();
    const { estimate, step } = await runToEnd();
    expect(estimate.continues).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(step.status).toBe("stopped");
    expect(await listCycles(1)).toHaveLength(1);
  });

  it("refuses other projects before sending anything", async () => {
    await writePrompts(2, [{ id: "x", text: "best wine", topic: "General", branded: false, source: "manual", active: true, createdAt: "2026-10-16" }]);
    await expect(beginBrandRun(user, other)).rejects.toThrow(/Nothing can run right now/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
