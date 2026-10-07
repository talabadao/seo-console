import { db } from "@/lib/db";
import { accessTokenFor } from "@/lib/google/oauth";
import type { UserRow } from "@/lib/session";
import {
  STRATEGIES,
  parsePsi,
  type PsiResult,
  type Recommendation,
  type Strategy,
} from "@/lib/pagespeedParse";

const PSI = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/** Tracked pages per project — each costs two PageSpeed runs (mobile + desktop) a day. */
export const MAX_PAGES_PER_PROJECT = 15;

export { STRATEGIES, type Recommendation, type Strategy };

function cleanPsiError(status: number, body: string): string {
  let msg = "";
  try {
    msg = JSON.parse(body)?.error?.message ?? "";
  } catch {
    /* not JSON */
  }
  if (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(msg || body)) {
    return "The PageSpeed Insights API isn't enabled in your Google Cloud project. Enable it in Google Cloud Console → APIs & Services, then run again.";
  }
  if (status === 429 || /quota|rate limit/i.test(msg)) {
    return "PageSpeed Insights quota reached — it will be retried on the next daily run.";
  }
  if (/FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|NO_FCP|DNS_FAILURE|unable to reliably load/i.test(msg)) {
    return "Google couldn't load this page. Check that the URL is public and loads in a browser.";
  }
  return `PageSpeed Insights ${status}: ${(msg || body).slice(0, 180)}`;
}

/**
 * One live PageSpeed Insights run (15–60s). Uses PAGESPEED_API_KEY when set,
 * otherwise the user's Google sign-in, so usage counts against the same
 * Google Cloud project as the rest of the console.
 */
export async function runPsi(url: string, strategy: Strategy, token: string | null): Promise<PsiResult> {
  const qs = new URLSearchParams({ url, strategy, category: "performance" });
  const key = process.env.PAGESPEED_API_KEY;
  if (key) qs.set("key", key);
  const res = await fetch(`${PSI}?${qs}`, {
    headers: !key && token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(110_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(cleanPsiError(res.status, body));
  return parsePsi(JSON.parse(body));
}

// ---------- storage ----------

export interface PsiPage {
  id: number;
  projectId: number;
  url: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** The page, only if it belongs to one of this user's projects. */
export async function pageFor(userId: number, pageId: number): Promise<PsiPage | null> {
  const row = await db
    .prepare(
      `SELECT g.id, g.project_id AS "projectId", g.url
         FROM psi_pages g JOIN projects p ON p.id = g.project_id
        WHERE g.id = ? AND p.user_id = ?`,
    )
    .get(pageId, userId);
  return (row as unknown as PsiPage | undefined) ?? null;
}

export async function addPage(projectId: number, url: string): Promise<PsiPage> {
  const res = await db
    .prepare(
      `INSERT INTO psi_pages (project_id, url, created_at) VALUES (?, ?, ?)
       ON CONFLICT (project_id, url) DO UPDATE SET url = EXCLUDED.url RETURNING id`,
    )
    .run(projectId, url, Date.now());
  return { id: Number(res.rows[0].id), projectId, url };
}

export async function countPages(projectId: number): Promise<number> {
  const r = (await db.prepare("SELECT COUNT(*) AS n FROM psi_pages WHERE project_id = ?").get(projectId)) as {
    n: number;
  };
  return Number(r.n);
}

export async function removePage(pageId: number): Promise<void> {
  await db.prepare("DELETE FROM psi_pages WHERE id = ?").run(pageId);
}

async function saveRun(pageId: number, strategy: Strategy, r: PsiResult | null, error: string | null) {
  // A failed run never overwrites a good result already stored for today.
  if (!r) {
    await db
      .prepare(
        `INSERT INTO psi_runs (page_id, strategy, run_date, fetched_at, error) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (page_id, strategy, run_date) DO UPDATE SET
           error = EXCLUDED.error, fetched_at = EXCLUDED.fetched_at
         WHERE psi_runs.score IS NULL`,
      )
      .run(pageId, strategy, today(), Date.now(), error);
    return;
  }
  await db
    .prepare(
      `INSERT INTO psi_runs
         (page_id, strategy, run_date, fetched_at, score, fcp, lcp, tbt, cls, si,
          field_lcp, field_inp, field_cls, field_fcp, field_ttfb, field_category, field_origin,
          recs_json, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT (page_id, strategy, run_date) DO UPDATE SET
         fetched_at = EXCLUDED.fetched_at, score = EXCLUDED.score, fcp = EXCLUDED.fcp,
         lcp = EXCLUDED.lcp, tbt = EXCLUDED.tbt, cls = EXCLUDED.cls, si = EXCLUDED.si,
         field_lcp = EXCLUDED.field_lcp, field_inp = EXCLUDED.field_inp,
         field_cls = EXCLUDED.field_cls, field_fcp = EXCLUDED.field_fcp,
         field_ttfb = EXCLUDED.field_ttfb, field_category = EXCLUDED.field_category,
         field_origin = EXCLUDED.field_origin, recs_json = EXCLUDED.recs_json, error = NULL`,
    )
    .run(
      pageId,
      strategy,
      today(),
      Date.now(),
      r.score,
      r.fcp,
      r.lcp,
      r.tbt,
      r.cls,
      r.si,
      r.fieldLcp,
      r.fieldInp,
      r.fieldCls,
      r.fieldFcp,
      r.fieldTtfb,
      r.fieldCategory,
      r.fieldOrigin,
      JSON.stringify(r.recommendations),
    );
}

/** Runs one page for one strategy and stores the outcome (result or error). */
export async function runAndStore(
  page: { id: number; url: string },
  strategy: Strategy,
  token: string | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await saveRun(page.id, strategy, await runPsi(page.url, strategy, token), null);
    return { ok: true };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const error = /aborted|timeout/i.test(raw) ? "PageSpeed Insights took too long to answer." : raw;
    await saveRun(page.id, strategy, null, error);
    return { ok: false, error };
  }
}

export interface RunRow {
  strategy: Strategy;
  date: string;
  fetchedAt: number;
  score: number | null;
  fcp: number | null;
  lcp: number | null;
  tbt: number | null;
  cls: number | null;
  si: number | null;
  fieldLcp: number | null;
  fieldInp: number | null;
  fieldCls: number | null;
  fieldFcp: number | null;
  fieldTtfb: number | null;
  fieldCategory: string | null;
  fieldOrigin: boolean;
  error: string | null;
}

const RUN_COLUMNS = `strategy, run_date AS date, fetched_at AS "fetchedAt", score, fcp, lcp, tbt, cls, si,
  field_lcp AS "fieldLcp", field_inp AS "fieldInp", field_cls AS "fieldCls",
  field_fcp AS "fieldFcp", field_ttfb AS "fieldTtfb", field_category AS "fieldCategory",
  field_origin AS "fieldOrigin", error`;

export interface PageSummary {
  id: number;
  url: string;
  /** Most recent run per strategy (may be an error row). */
  latest: Partial<Record<Strategy, RunRow>>;
  /** Score per day, oldest first, for the row sparkline. */
  trend: Partial<Record<Strategy, { date: string; score: number }[]>>;
}

export async function projectPages(projectId: number): Promise<PageSummary[]> {
  const pages = (await db
    .prepare("SELECT id, url FROM psi_pages WHERE project_id = ? ORDER BY created_at, id")
    .all(projectId)) as { id: number; url: string }[];
  if (!pages.length) return [];
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const runs = (await db
    .prepare(
      `SELECT r.page_id AS "pageId", ${RUN_COLUMNS}
         FROM psi_runs r JOIN psi_pages g ON g.id = r.page_id
        WHERE g.project_id = ? AND r.run_date >= ? ORDER BY r.run_date`,
    )
    .all(projectId, since)) as unknown as (RunRow & { pageId: number })[];

  return pages.map((p) => {
    const mine = runs.filter((r) => r.pageId === p.id);
    const latest: PageSummary["latest"] = {};
    const trend: PageSummary["trend"] = {};
    for (const s of STRATEGIES) {
      const rows = mine.filter((r) => r.strategy === s);
      if (rows.length) latest[s] = rows[rows.length - 1];
      trend[s] = rows.filter((r) => r.score != null).map((r) => ({ date: r.date, score: r.score! }));
    }
    return { id: p.id, url: p.url, latest, trend };
  });
}

export async function pageHistory(
  pageId: number,
  days: number,
): Promise<{ runs: RunRow[]; recommendations: Partial<Record<Strategy, Recommendation[]>> }> {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const runs = (await db
    .prepare(`SELECT ${RUN_COLUMNS} FROM psi_runs WHERE page_id = ? AND run_date >= ? ORDER BY run_date`)
    .all(pageId, since)) as unknown as RunRow[];

  const recommendations: Partial<Record<Strategy, Recommendation[]>> = {};
  for (const s of STRATEGIES) {
    const row = (await db
      .prepare(
        `SELECT recs_json FROM psi_runs WHERE page_id = ? AND strategy = ? AND recs_json IS NOT NULL
          ORDER BY run_date DESC LIMIT 1`,
      )
      .get(pageId, s)) as { recs_json: string } | undefined;
    if (!row) continue;
    try {
      recommendations[s] = JSON.parse(row.recs_json);
    } catch {
      /* skip malformed */
    }
  }
  return { runs, recommendations };
}

/**
 * Daily job: runs every tracked page that has no successful result yet today,
 * a few at a time, until the time budget is spent. Safe to call several times
 * a day — later calls only pick up what earlier ones didn't finish.
 */
export async function runDuePages(budgetMs: number): Promise<{ ran: number; failed: number; left: number }> {
  const started = Date.now();
  const due = (await db
    .prepare(
      `SELECT g.id, g.url, s.strategy, p.user_id AS "userId"
         FROM psi_pages g
         JOIN projects p ON p.id = g.project_id
         CROSS JOIN (VALUES ('mobile'), ('desktop')) AS s(strategy)
        WHERE NOT EXISTS (
                SELECT 1 FROM psi_runs r
                 WHERE r.page_id = g.id AND r.strategy = s.strategy AND r.run_date = ? AND r.score IS NOT NULL)
        ORDER BY g.id`,
    )
    .all(today())) as { id: number; url: string; strategy: Strategy; userId: number }[];

  // One access token per user (only needed when no API key is configured).
  const tokens = new Map<number, string | null>();
  async function tokenFor(userId: number): Promise<string | null> {
    if (process.env.PAGESPEED_API_KEY) return null;
    if (!tokens.has(userId)) {
      const user = (await db.prepare("SELECT * FROM users WHERE id = ?").get(userId)) as UserRow | undefined;
      let token: string | null = null;
      try {
        if (user) token = await accessTokenFor(user);
      } catch {
        /* run unauthenticated */
      }
      tokens.set(userId, token);
    }
    return tokens.get(userId) ?? null;
  }

  let ran = 0;
  let failed = 0;
  let next = 0;
  async function worker() {
    while (next < due.length && Date.now() - started < budgetMs) {
      const job = due[next++];
      const r = await runAndStore(job, job.strategy, await tokenFor(job.userId));
      if (r.ok) ran++;
      else failed++;
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  return { ran, failed, left: due.length - ran - failed };
}
