import { db, rawSql } from "@/lib/db";
import { accessTokenFor } from "@/lib/google/oauth";
import { inspectUrl, listSitemaps } from "@/lib/google/searchconsole";
import { publishUrl, serviceAccountConfigured } from "@/lib/google/indexingApi";
import type { UserRow } from "@/lib/session";

export interface SiteRow {
  id: number;
  user_id: number;
  source: string;
  property: string;
}

// URL Inspection API limit is 2,000 queries/day per property (600/min).
// https://developers.google.com/webmaster-tools/limits
const DAILY_CAP = Number(process.env.INDEX_DAILY_CAP || 2000);
// One interactive "Run check" click stays well under the route timeout; the
// nightly `npm run sync` uses the full daily budget.
const PER_RUN_CAP = Number(process.env.INDEX_PER_RUN_CAP || 500);
const INSPECT_DELAY_MS = Number(process.env.INDEX_INSPECT_DELAY_MS || 40); // ~<600/min
const STALE_MS = 3 * 24 * 60 * 60 * 1000; // re-inspect after 3 days
const MAX_SITEMAP_FETCHES = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- sitemap discovery ----------

function originsFor(property: string): string[] {
  if (property.startsWith("sc-domain:")) {
    const d = property.slice("sc-domain:".length);
    return [`https://${d}`, `https://www.${d}`];
  }
  try {
    return [new URL(property).origin];
  } catch {
    return [];
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "SEO-Console/0.1" } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>\\s*([^<]+?)\\s*</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

async function collectFromSitemap(
  url: string,
  seen: Set<string>,
  urls: Set<string>,
  budget: { left: number },
  depth = 0,
): Promise<void> {
  if (budget.left <= 0 || depth > 4 || seen.has(url)) return;
  seen.add(url);
  budget.left--;
  const xml = await fetchText(url);
  if (!xml) return;

  if (/<sitemapindex/i.test(xml)) {
    for (const loc of extractTags(xml, "loc")) {
      await collectFromSitemap(loc, seen, urls, budget, depth + 1);
    }
  } else {
    for (const loc of extractTags(xml, "loc")) urls.add(loc);
  }
}

export async function discoverSitemapUrls(
  user: UserRow,
  site: SiteRow,
  manualSitemapUrl?: string,
): Promise<{ found: number; sitemaps: string[] }> {
  const roots = new Set<string>();

  if (manualSitemapUrl) roots.add(manualSitemapUrl.trim());

  // 1. Sitemaps submitted in Search Console
  try {
    const token = await accessTokenFor(user);
    for (const s of await listSitemaps(token, site.property)) {
      if (s.path) roots.add(s.path);
    }
  } catch {
    /* ignore — fall back to robots/well-known */
  }

  // 2. robots.txt + /sitemap.xml on each candidate origin
  for (const origin of originsFor(site.property)) {
    const robots = await fetchText(`${origin}/robots.txt`);
    if (robots) {
      for (const line of robots.split(/\r?\n/)) {
        const m = /^\s*sitemap:\s*(\S+)/i.exec(line);
        if (m) roots.add(m[1].trim());
      }
    }
    roots.add(`${origin}/sitemap.xml`);
  }

  const urls = new Set<string>();
  const seen = new Set<string>();
  const budget = { left: MAX_SITEMAP_FETCHES };
  for (const r of roots) await collectFromSitemap(r, seen, urls, budget);

  const now = Date.now();
  const source = manualSitemapUrl ? "manual" : "sitemap";
  const values = [...urls].map((url) => ({
    site_id: site.id,
    url,
    source,
    first_seen: now,
    last_seen: now,
  }));
  if (values.length) {
    const sql = await rawSql();
    const CHUNK = 500;
    for (let i = 0; i < values.length; i += CHUNK) {
      const chunk = values.slice(i, i + CHUNK);
      // No explicit "VALUES" keyword here — postgres.js picks which of its
      // sql(...) helper behaviors to use by scanning the SQL text immediately
      // before the placeholder for the rightmost keyword match. Writing
      // "VALUES" ourselves makes it match the plain `values` builder (which
      // expects an array of row-tuples), not `insert` (which expects an
      // array of row-objects, what `chunk` actually is) — every column then
      // silently resolved to undefined and got written as NULL.
      await sql`
        INSERT INTO sitemap_urls ${sql(chunk, "site_id", "url", "source", "first_seen", "last_seen")}
        ON CONFLICT (site_id, url) DO UPDATE SET last_seen = EXCLUDED.last_seen
      `;
    }
  }

  return { found: urls.size, sitemaps: [...seen] };
}

// ---------- inspection ----------

function isIndexed(coverage: string | null, verdict: string | null): boolean {
  if (coverage) {
    if (/not indexed/i.test(coverage)) return false;
    if (/indexed/i.test(coverage)) return true;
  }
  return verdict === "PASS";
}

// Fixed display order + colour for the coverage-state stacked chart.
export const COVERAGE_STATES: { match: RegExp; label: string; color: string; indexed: boolean }[] = [
  { match: /submitted and indexed/i, label: "Submitted and indexed", color: "#34a853", indexed: true },
  { match: /indexed, not submitted/i, label: "Indexed, not in sitemap", color: "#81c995", indexed: true },
  { match: /crawled - currently not indexed/i, label: "Crawled – not indexed", color: "#f9ab00", indexed: false },
  { match: /discovered - currently not indexed/i, label: "Discovered – not indexed", color: "#ea4335", indexed: false },
  { match: /alternate page with proper canonical/i, label: "Alternate w/ canonical", color: "#4285f4", indexed: false },
  { match: /duplicate/i, label: "Duplicate / canonical", color: "#a142f4", indexed: false },
  { match: /excluded by .?noindex/i, label: "Excluded by noindex", color: "#c5221f", indexed: false },
  { match: /blocked by robots/i, label: "Blocked by robots.txt", color: "#5f6368", indexed: false },
  { match: /redirect/i, label: "Page with redirect", color: "#9aa0a6", indexed: false },
  { match: /soft 404/i, label: "Soft 404", color: "#795548", indexed: false },
  { match: /not found|404/i, label: "Not found (404)", color: "#8d6e63", indexed: false },
  { match: /server error|5xx/i, label: "Server error (5xx)", color: "#b71c1c", indexed: false },
  { match: /unknown to google/i, label: "Unknown to Google", color: "#00acc1", indexed: false },
];

export function normalizeState(coverage: string | null): string {
  if (!coverage) return "Not inspected";
  const hit = COVERAGE_STATES.find((s) => s.match.test(coverage));
  return hit ? hit.label : coverage;
}

export function stateColor(label: string): string {
  return COVERAGE_STATES.find((s) => s.label === label)?.color ?? "#9aa0a6";
}

async function quotaLeft(siteId: number): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const row = (await db
    .prepare("SELECT inspections FROM quota_usage WHERE site_id = ? AND usage_date = ?")
    .get(siteId, today)) as { inspections: number } | undefined;
  return DAILY_CAP - (row?.inspections ?? 0);
}

async function bumpQuota(siteId: number, n: number) {
  const today = new Date().toISOString().slice(0, 10);
  await db
    .prepare(
      `INSERT INTO quota_usage (site_id, usage_date, inspections) VALUES (?, ?, ?)
       ON CONFLICT(site_id, usage_date) DO UPDATE SET inspections = quota_usage.inspections + excluded.inspections`,
    )
    .run(siteId, today, n);
}

// The Indexing API allows ~200 publish calls/day per project by default.
const SUBMIT_DAILY_CAP = Number(process.env.INDEX_SUBMIT_DAILY_CAP || 190);

export async function submitQuotaLeft(siteId: number): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const row = (await db
    .prepare("SELECT submissions FROM quota_usage WHERE site_id = ? AND usage_date = ?")
    .get(siteId, today)) as { submissions: number } | undefined;
  return SUBMIT_DAILY_CAP - (row?.submissions ?? 0);
}

async function bumpSubmitQuota(siteId: number, n: number) {
  const today = new Date().toISOString().slice(0, 10);
  await db
    .prepare(
      `INSERT INTO quota_usage (site_id, usage_date, submissions) VALUES (?, ?, ?)
       ON CONFLICT(site_id, usage_date) DO UPDATE SET submissions = quota_usage.submissions + excluded.submissions`,
    )
    .run(siteId, today, n);
}

export async function runIndexCheck(
  user: UserRow,
  site: SiteRow,
  opts: { max?: number; interactive?: boolean } = {},
): Promise<{ checked: number; quotaLeft: number; message?: string }> {
  await db
    .prepare(
      `INSERT INTO index_jobs (site_id, started_at, status, checked) VALUES (?, ?, 'running', 0)
       ON CONFLICT(site_id) DO UPDATE SET started_at = excluded.started_at, status = 'running', checked = 0, finished_at = NULL, message = NULL`,
    )
    .run(site.id, Date.now());

  const requested = opts.max ?? (opts.interactive ? PER_RUN_CAP : DAILY_CAP);
  const cap = Math.min(requested, await quotaLeft(site.id));
  if (cap <= 0) {
    await db
      .prepare(
        "UPDATE index_jobs SET status = 'done', finished_at = ?, message = 'daily quota reached' WHERE site_id = ?",
      )
      .run(Date.now(), site.id);
    return { checked: 0, quotaLeft: 0, message: "Daily inspection quota reached." };
  }

  // URLs never inspected, then oldest-inspected, up to cap.
  const targets = (await db
    .prepare(`
      SELECT s.url AS url, i.inspected_at AS inspected_at
        FROM sitemap_urls s
        LEFT JOIN url_inspections i ON i.site_id = s.site_id AND i.url = s.url
       WHERE s.site_id = ?
         AND (i.inspected_at IS NULL OR i.inspected_at < ?)
       ORDER BY i.inspected_at IS NOT NULL, i.inspected_at ASC
       LIMIT ?
    `)
    .all(site.id, Date.now() - STALE_MS, cap)) as { url: string; inspected_at: number | null }[];

  let token: string;
  try {
    token = await accessTokenFor(user);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .prepare("UPDATE index_jobs SET status = 'error', finished_at = ?, message = ? WHERE site_id = ?")
      .run(Date.now(), msg, site.id);
    return { checked: 0, quotaLeft: await quotaLeft(site.id), message: msg };
  }

  const prior = db.prepare(
    "SELECT coverage_state FROM url_inspections WHERE site_id = ? AND url = ?",
  );
  const save = db.prepare(`
    INSERT INTO url_inspections
      (site_id, url, inspected_at, verdict, coverage_state, robots_txt_state, indexing_state,
       page_fetch_state, last_crawl_time, google_canonical, user_canonical, crawled_as,
       rich_results, rich_verdict, inspect_link, in_sitemap, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(site_id, url) DO UPDATE SET
      inspected_at = excluded.inspected_at, verdict = excluded.verdict,
      coverage_state = excluded.coverage_state, robots_txt_state = excluded.robots_txt_state,
      indexing_state = excluded.indexing_state, page_fetch_state = excluded.page_fetch_state,
      last_crawl_time = excluded.last_crawl_time, google_canonical = excluded.google_canonical,
      user_canonical = excluded.user_canonical, crawled_as = excluded.crawled_as,
      rich_results = excluded.rich_results, rich_verdict = excluded.rich_verdict,
      inspect_link = excluded.inspect_link, in_sitemap = 1, raw_json = excluded.raw_json
  `);
  const logChange = db.prepare(`
    INSERT INTO url_status_history (site_id, url, changed_at, before_state, after_state, indexing_change)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let checked = 0;
  let lastError: string | undefined;
  for (const t of targets) {
    if (checked > 0 && INSPECT_DELAY_MS > 0) await sleep(INSPECT_DELAY_MS);
    try {
      const r = await inspectUrl(token, site.property, t.url);
      const idx = r.indexStatusResult ?? {};
      const newState = idx.coverageState ?? null;
      const rich =
        r.richResultsResult?.detectedItems
          ?.map((d) => d.richResultType)
          .filter(Boolean)
          .join(", ") || null;

      const before = (
        (await prior.get(site.id, t.url)) as { coverage_state: string | null } | undefined
      )?.coverage_state;
      if (before !== undefined && before !== newState) {
        await logChange.run(
          site.id,
          t.url,
          Date.now(),
          before,
          newState,
          isIndexed(before, null) !== isIndexed(newState, idx.verdict ?? null) ? 1 : 0,
        );
      }

      await save.run(
        site.id,
        t.url,
        Date.now(),
        idx.verdict ?? null,
        newState,
        idx.robotsTxtState ?? null,
        idx.indexingState ?? null,
        idx.pageFetchState ?? null,
        idx.lastCrawlTime ?? null,
        idx.googleCanonical ?? null,
        idx.userCanonical ?? null,
        idx.crawledAs ?? null,
        rich,
        r.richResultsResult?.verdict ?? null,
        r.inspectionResultLink ?? "",
        JSON.stringify(r),
      );
      checked++;
      await bumpQuota(site.id, 1);
      await db.prepare("UPDATE index_jobs SET checked = ? WHERE site_id = ?").run(checked, site.id);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (/quota|rate|429/i.test(lastError)) break;
    }
  }

  await writeSnapshot(site.id);

  const left = await quotaLeft(site.id);
  const more =
    !lastError && checked >= cap && left > 0 && targets.length === cap
      ? "Run-limit reached — click again to keep going."
      : undefined;

  await db
    .prepare(
      "UPDATE index_jobs SET status = 'done', finished_at = ?, checked = ?, message = ? WHERE site_id = ?",
    )
    .run(Date.now(), checked, lastError ?? more ?? null, site.id);

  return { checked, quotaLeft: left, message: lastError ?? more };
}

export async function writeSnapshot(siteId: number) {
  const rows = (await db
    .prepare(
      `SELECT i.coverage_state AS c, i.verdict AS v
         FROM url_inspections i
         JOIN sitemap_urls s ON s.site_id = i.site_id AND s.url = i.url
        WHERE i.site_id = ?`,
    )
    .all(siteId)) as { c: string | null; v: string | null }[];
  let indexed = 0;
  const states: Record<string, number> = {};
  for (const r of rows) {
    if (isIndexed(r.c, r.v)) indexed++;
    const label = normalizeState(r.c);
    states[label] = (states[label] ?? 0) + 1;
  }
  const total = (await db
    .prepare("SELECT COUNT(*) AS n FROM sitemap_urls WHERE site_id = ?")
    .get(siteId)) as { n: number };
  const today = new Date().toISOString().slice(0, 10);
  await db
    .prepare(
      `INSERT INTO index_snapshots (site_id, snap_date, indexed, not_indexed, total_known, states_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(site_id, snap_date) DO UPDATE SET
         indexed = excluded.indexed, not_indexed = excluded.not_indexed,
         total_known = excluded.total_known, states_json = excluded.states_json`,
    )
    .run(siteId, today, indexed, rows.length - indexed, total.n, JSON.stringify(states));
}

// ---------- dashboard data ----------

export interface IndexUrlRow {
  url: string;
  clicks: number;
  impressions: number;
  status: string | null;
  stateLabel: string;
  indexed: boolean;
  atRisk: boolean;
  lastCrawl: string | null;
  richResults: string | null;
  richVerdict: string | null;
  lastInspection: number | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  crawledAs: string | null;
  submittedAt: number | null;
  submitResult: string | null;
  submittable: boolean;
  unknownToGoogle: boolean;
  /**
   * Deep link to this URL's inspection page in Search Console (for the manual
   * "Request indexing" button). Only Google can mint the `id` token, so this is
   * the API's `inspectionResultLink` verbatim — null until the URL is inspected.
   */
  requestIndexingUrl: string | null;
}

/** URLs Google doesn't know at all, or has crawled but not indexed — worth a nudge. */
function isSubmittable(status: string | null, indexed: boolean, inspected: boolean): boolean {
  if (indexed) return false;
  if (!inspected) return false;
  if (!status) return true;
  return /unknown to google|not indexed|discovered|crawled/i.test(status);
}

/** Populate inspect_link from stored raw_json for rows saved before the column existed. */
async function backfillInspectLinks(siteId: number) {
  const rows = (await db
    .prepare(
      "SELECT id, raw_json FROM url_inspections WHERE site_id = ? AND inspect_link IS NULL AND raw_json IS NOT NULL LIMIT 10000",
    )
    .all(siteId)) as { id: number; raw_json: string }[];
  if (!rows.length) return;
  const upd = db.prepare("UPDATE url_inspections SET inspect_link = ? WHERE id = ?");
  for (const r of rows) {
    let link = "";
    try {
      link = JSON.parse(r.raw_json)?.inspectionResultLink ?? "";
    } catch {
      /* keep "" */
    }
    await upd.run(link, r.id); // "" marks "checked, no link" so we don't re-scan
  }
}

export async function indexDashboard(siteId: number) {
  await backfillInspectLinks(siteId);
  const maxDateRow = (await db
    .prepare("SELECT MAX(data_date) AS d FROM perf_rows WHERE site_id = ? AND dimension = 'page'")
    .get(siteId)) as { d: string | null };
  const maxDate = maxDateRow.d;
  const since = maxDate
    ? new Date(new Date(maxDate).getTime() - 30 * 86400000).toISOString().slice(0, 10)
    : "1970-01-01";

  // URLs regressed from indexed -> not-indexed in the last 30 days and still down.
  const atRiskSet = new Set(
    (
      (await db
        .prepare(`
          SELECT url FROM url_status_history
           WHERE site_id = ? AND indexing_change = 1 AND changed_at > ?
             AND after_state NOT LIKE '%indexed%'
        `)
        .all(siteId, Date.now() - 30 * 86400000)) as { url: string }[]
    ).map((r) => r.url),
  );

  const rows = (await db
    .prepare(`
      SELECT s.url AS url,
             i.coverage_state AS status, i.verdict AS verdict,
             i.last_crawl_time AS "lastCrawl", i.rich_results AS "richResults", i.rich_verdict AS "richVerdict",
             i.inspected_at AS "lastInspection", i.robots_txt_state AS "robotsTxtState",
             i.indexing_state AS "indexingState", i.page_fetch_state AS "pageFetchState",
             i.google_canonical AS "googleCanonical", i.user_canonical AS "userCanonical",
             i.crawled_as AS "crawledAs", i.inspect_link AS "inspectLink",
             i.submitted_at AS "submittedAt", i.submit_result AS "submitResult",
             COALESCE((SELECT SUM(clicks) FROM perf_rows p
                        WHERE p.site_id = s.site_id AND p.dimension = 'page'
                          AND p.key = s.url AND p.data_date >= ?), 0) AS clicks,
             COALESCE((SELECT SUM(impressions) FROM perf_rows p
                        WHERE p.site_id = s.site_id AND p.dimension = 'page'
                          AND p.key = s.url AND p.data_date >= ?), 0) AS impressions
        FROM sitemap_urls s
        LEFT JOIN url_inspections i ON i.site_id = s.site_id AND i.url = s.url
       WHERE s.site_id = ?
       ORDER BY impressions DESC, clicks DESC
    `)
    .all(since, since, siteId)) as (Omit<
    IndexUrlRow,
    "indexed" | "stateLabel" | "atRisk" | "submittable" | "unknownToGoogle" | "requestIndexingUrl"
  > & { verdict: string | null; inspectLink: string | null })[];

  const urls: IndexUrlRow[] = rows.map((r) => {
    const indexed = isIndexed(r.status, r.verdict);
    return {
      ...r,
      indexed,
      stateLabel: normalizeState(r.status),
      atRisk: atRiskSet.has(r.url),
      submittable: isSubmittable(r.status, indexed, Boolean(r.lastInspection)),
      unknownToGoogle: /unknown to google/i.test(r.status ?? ""),
      requestIndexingUrl: r.inspectLink || null,
    };
  });

  const indexed = urls.filter((u) => u.indexed).length;
  const inspected = urls.filter((u) => u.lastInspection).length;

  // Current state breakdown (for the donut / legend), in the fixed display order.
  const counts: Record<string, number> = {};
  for (const u of urls) counts[u.stateLabel] = (counts[u.stateLabel] ?? 0) + 1;
  const stateBreakdown = [
    ...COVERAGE_STATES.map((s) => s.label),
    ...Object.keys(counts).filter(
      (l) => !COVERAGE_STATES.some((s) => s.label === l) && l !== "Not inspected",
    ),
    "Not inspected",
  ]
    .filter((l, idx, arr) => arr.indexOf(l) === idx && counts[l])
    .map((label) => ({ label, count: counts[label], color: stateColor(label) }));

  const stateHistory = (
    (await db
      .prepare(
        `SELECT snap_date AS date, states_json AS "statesJson", indexed, not_indexed AS "notIndexed"
           FROM index_snapshots WHERE site_id = ? ORDER BY snap_date`,
      )
      .all(siteId)) as {
      date: string;
      statesJson: string | null;
      indexed: number;
      notIndexed: number;
    }[]
  ).map((r) => ({
    date: r.date,
    states: r.statesJson ? (JSON.parse(r.statesJson) as Record<string, number>) : null,
    indexed: r.indexed,
    notIndexed: r.notIndexed,
  }));

  const recentCutoff = Date.now() - 30 * 86400000;
  const movements = (
    (await db
      .prepare(`
        SELECT h.changed_at AS "changedAt", h.url AS url, h.before_state AS before,
               h.after_state AS after, h.indexing_change AS "indexingChange",
               s.first_seen AS "firstSeen"
          FROM url_status_history h
          LEFT JOIN sitemap_urls s ON s.site_id = h.site_id AND s.url = h.url
         WHERE h.site_id = ?
         ORDER BY h.changed_at DESC
         LIMIT 500
      `)
      .all(siteId)) as {
      changedAt: number;
      url: string;
      before: string | null;
      after: string | null;
      indexingChange: number;
      firstSeen: number | null;
    }[]
  ).map((m) => ({
    ...m,
    recentlyPublished:
      Boolean(m.firstSeen && m.firstSeen > recentCutoff) && !/indexed/i.test(m.after ?? ""),
  }));

  const job = (await db.prepare("SELECT * FROM index_jobs WHERE site_id = ?").get(siteId)) ?? null;
  const siteRow = (await db
    .prepare("SELECT permission_level FROM sites WHERE id = ?")
    .get(siteId)) as { permission_level: string | null } | undefined;

  return {
    total: urls.length,
    inspected,
    indexed,
    notIndexed: inspected - indexed,
    pctIndexed: urls.length ? Math.round((indexed / urls.length) * 100) : 0,
    submittableCount: urls.filter((u) => u.submittable).length,
    atRiskCount: urls.filter((u) => u.atRisk).length,
    urls,
    stateBreakdown,
    stateHistory,
    movements,
    job,
    quotaLeft: await quotaLeft(siteId),
    dailyCap: DAILY_CAP,
    submitQuotaLeft: await submitQuotaLeft(siteId),
    indexing: {
      configured: true,
      serviceAccount: serviceAccountConfigured(),
      permissionLevel: siteRow?.permission_level ?? null,
      isOwner: siteRow?.permission_level === "siteOwner",
    },
  };
}

// ---------- submit to Google Indexing API ----------

export interface SubmitOutcome {
  results: { url: string; ok: boolean; message: string }[];
  skipped: number; // over daily quota
  quotaLeft: number;
}

export async function submitUrls(
  site: SiteRow,
  urls: string[],
  userToken?: string,
): Promise<SubmitOutcome> {
  const results: SubmitOutcome["results"] = [];
  const mark = db.prepare(
    "UPDATE url_inspections SET submitted_at = ?, submit_result = ? WHERE site_id = ? AND url = ?",
  );
  const ensureRow = db.prepare(
    `INSERT INTO url_inspections (site_id, url, inspected_at, in_sitemap)
     VALUES (?, ?, 0, 1) ON CONFLICT(site_id, url) DO NOTHING`,
  );

  const budget = Math.max(0, await submitQuotaLeft(site.id));
  const doNow = urls.slice(0, budget);
  const skipped = urls.length - doNow.length;

  let spent = 0;
  for (const url of doNow) {
    try {
      await publishUrl(url, { userToken });
      await ensureRow.run(site.id, url);
      await mark.run(Date.now(), "ok", site.id, url);
      results.push({ url, ok: true, message: "submitted" });
      spent++;
    } catch (e) {
      const message = cleanApiError(e instanceof Error ? e.message : String(e));
      await ensureRow.run(site.id, url);
      await mark.run(Date.now(), message, site.id, url);
      results.push({ url, ok: false, message });
      // Auth/permission failures don't consume the publish quota; keep trying
      // the rest so the user sees the real reason, but stop on a rate-limit.
      if (/rate|RESOURCE_EXHAUSTED|quota/i.test(message)) break;
    }
  }
  if (spent) await bumpSubmitQuota(site.id, spent);

  return { results, skipped, quotaLeft: await submitQuotaLeft(site.id) };
}

/** Turn a raw "Indexing API 403: {json}" string into something readable. */
function cleanApiError(raw: string): string {
  const m = /Indexing API (\d+):\s*(\{[\s\S]*\})?/.exec(raw);
  if (!m) return raw.slice(0, 160);
  const code = m[1];
  try {
    const j = JSON.parse(m[2] ?? "{}");
    const msg = j?.error?.message ?? "";
    if (/insufficient authentication scopes/i.test(msg))
      return `${code}: reconnect Google to grant the Indexing permission`;
    if (/verify.*ownership|not.*owner/i.test(msg))
      return `${code}: this Google account isn't an Owner of the property in Search Console`;
    return `${code}: ${String(msg).slice(0, 140)}`;
  } catch {
    return `${code}: ${raw.slice(0, 140)}`;
  }
}
