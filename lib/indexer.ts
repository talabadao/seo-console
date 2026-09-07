import { db } from "@/lib/db";
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

const DAILY_CAP = Number(process.env.INDEX_DAILY_CAP || 200);
const STALE_MS = 3 * 24 * 60 * 60 * 1000; // re-inspect after 3 days
const MAX_SITEMAP_FETCHES = 50;

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
  const upsert = db.prepare(`
    INSERT INTO sitemap_urls (site_id, url, source, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(site_id, url) DO UPDATE SET last_seen = excluded.last_seen
  `);
  for (const u of urls) {
    upsert.run(site.id, u, manualSitemapUrl ? "manual" : "sitemap", now, now);
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

function quotaLeft(siteId: number): number {
  const today = new Date().toISOString().slice(0, 10);
  const row = db
    .prepare("SELECT inspections FROM quota_usage WHERE site_id = ? AND usage_date = ?")
    .get(siteId, today) as { inspections: number } | undefined;
  return DAILY_CAP - (row?.inspections ?? 0);
}

function bumpQuota(siteId: number, n: number) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO quota_usage (site_id, usage_date, inspections) VALUES (?, ?, ?)
    ON CONFLICT(site_id, usage_date) DO UPDATE SET inspections = inspections + excluded.inspections
  `).run(siteId, today, n);
}

export async function runIndexCheck(
  user: UserRow,
  site: SiteRow,
  opts: { max?: number } = {},
): Promise<{ checked: number; quotaLeft: number; message?: string }> {
  db.prepare(`
    INSERT INTO index_jobs (site_id, started_at, status, checked) VALUES (?, ?, 'running', 0)
    ON CONFLICT(site_id) DO UPDATE SET started_at = excluded.started_at, status = 'running', checked = 0, finished_at = NULL, message = NULL
  `).run(site.id, Date.now());

  const cap = Math.min(opts.max ?? DAILY_CAP, quotaLeft(site.id));
  if (cap <= 0) {
    db.prepare(
      "UPDATE index_jobs SET status = 'done', finished_at = ?, message = 'daily quota reached' WHERE site_id = ?",
    ).run(Date.now(), site.id);
    return { checked: 0, quotaLeft: 0, message: "Daily inspection quota reached." };
  }

  // URLs never inspected, then oldest-inspected, up to cap.
  const targets = db
    .prepare(`
      SELECT s.url AS url, i.inspected_at AS inspected_at
        FROM sitemap_urls s
        LEFT JOIN url_inspections i ON i.site_id = s.site_id AND i.url = s.url
       WHERE s.site_id = ?
         AND (i.inspected_at IS NULL OR i.inspected_at < ?)
       ORDER BY i.inspected_at IS NOT NULL, i.inspected_at ASC
       LIMIT ?
    `)
    .all(site.id, Date.now() - STALE_MS, cap) as { url: string; inspected_at: number | null }[];

  let token: string;
  try {
    token = await accessTokenFor(user);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    db.prepare(
      "UPDATE index_jobs SET status = 'error', finished_at = ?, message = ? WHERE site_id = ?",
    ).run(Date.now(), msg, site.id);
    return { checked: 0, quotaLeft: quotaLeft(site.id), message: msg };
  }

  const save = db.prepare(`
    INSERT INTO url_inspections
      (site_id, url, inspected_at, verdict, coverage_state, robots_txt_state, indexing_state,
       page_fetch_state, last_crawl_time, google_canonical, user_canonical, crawled_as,
       rich_results, in_sitemap, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(site_id, url) DO UPDATE SET
      inspected_at = excluded.inspected_at, verdict = excluded.verdict,
      coverage_state = excluded.coverage_state, robots_txt_state = excluded.robots_txt_state,
      indexing_state = excluded.indexing_state, page_fetch_state = excluded.page_fetch_state,
      last_crawl_time = excluded.last_crawl_time, google_canonical = excluded.google_canonical,
      user_canonical = excluded.user_canonical, crawled_as = excluded.crawled_as,
      rich_results = excluded.rich_results, in_sitemap = 1, raw_json = excluded.raw_json
  `);

  let checked = 0;
  let lastError: string | undefined;
  for (const t of targets) {
    try {
      const r = await inspectUrl(token, site.property, t.url);
      const idx = r.indexStatusResult ?? {};
      const rich =
        r.richResultsResult?.detectedItems
          ?.map((d) => d.richResultType)
          .filter(Boolean)
          .join(", ") || null;
      save.run(
        site.id,
        t.url,
        Date.now(),
        idx.verdict ?? null,
        idx.coverageState ?? null,
        idx.robotsTxtState ?? null,
        idx.indexingState ?? null,
        idx.pageFetchState ?? null,
        idx.lastCrawlTime ?? null,
        idx.googleCanonical ?? null,
        idx.userCanonical ?? null,
        idx.crawledAs ?? null,
        rich,
        JSON.stringify(r),
      );
      checked++;
      bumpQuota(site.id, 1);
      db.prepare("UPDATE index_jobs SET checked = ? WHERE site_id = ?").run(checked, site.id);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (/quota|rate|429/i.test(lastError)) break;
    }
  }

  writeSnapshot(site.id);

  db.prepare(
    "UPDATE index_jobs SET status = 'done', finished_at = ?, checked = ?, message = ? WHERE site_id = ?",
  ).run(Date.now(), checked, lastError ?? null, site.id);

  return { checked, quotaLeft: quotaLeft(site.id), message: lastError };
}

export function writeSnapshot(siteId: number) {
  const rows = db
    .prepare(
      `SELECT i.coverage_state AS c, i.verdict AS v
         FROM url_inspections i
         JOIN sitemap_urls s ON s.site_id = i.site_id AND s.url = i.url
        WHERE i.site_id = ?`,
    )
    .all(siteId) as { c: string | null; v: string | null }[];
  let indexed = 0;
  for (const r of rows) if (isIndexed(r.c, r.v)) indexed++;
  const total = db
    .prepare("SELECT COUNT(*) AS n FROM sitemap_urls WHERE site_id = ?")
    .get(siteId) as { n: number };
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO index_snapshots (site_id, snap_date, indexed, not_indexed, total_known)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(site_id, snap_date) DO UPDATE SET
      indexed = excluded.indexed, not_indexed = excluded.not_indexed, total_known = excluded.total_known
  `).run(siteId, today, indexed, rows.length - indexed, total.n);
}

// ---------- dashboard data ----------

export interface IndexUrlRow {
  url: string;
  clicks: number;
  impressions: number;
  status: string | null;
  indexed: boolean;
  lastCrawl: string | null;
  richResults: string | null;
  lastInspection: number | null;
  robotsTxtState: string | null;
  googleCanonical: string | null;
  submittedAt: number | null;
  submitResult: string | null;
  submittable: boolean;
  unknownToGoogle: boolean;
}

/** URLs Google doesn't know at all, or has crawled but not indexed — worth a nudge. */
function isSubmittable(status: string | null, indexed: boolean, inspected: boolean): boolean {
  if (indexed) return false;
  if (!inspected) return false;
  if (!status) return true;
  return /unknown to google|not indexed|discovered|crawled/i.test(status);
}

export function indexDashboard(siteId: number) {
  const maxDateRow = db
    .prepare("SELECT MAX(data_date) AS d FROM perf_rows WHERE site_id = ? AND dimension = 'page'")
    .get(siteId) as { d: string | null };
  const maxDate = maxDateRow.d;
  const since = maxDate
    ? new Date(new Date(maxDate).getTime() - 30 * 86400000).toISOString().slice(0, 10)
    : "1970-01-01";

  const rows = db
    .prepare(`
      SELECT s.url AS url,
             i.coverage_state AS status, i.verdict AS verdict,
             i.last_crawl_time AS lastCrawl, i.rich_results AS richResults,
             i.inspected_at AS lastInspection, i.robots_txt_state AS robotsTxtState,
             i.google_canonical AS googleCanonical,
             i.submitted_at AS submittedAt, i.submit_result AS submitResult,
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
    .all(since, since, siteId) as (Omit<
      IndexUrlRow,
      "indexed" | "submittable" | "unknownToGoogle"
    > & { verdict: string | null })[];

  const urls: IndexUrlRow[] = rows.map((r) => {
    const indexed = isIndexed(r.status, r.verdict);
    return {
      ...r,
      indexed,
      submittable: isSubmittable(r.status, indexed, Boolean(r.lastInspection)),
      unknownToGoogle: /unknown to google/i.test(r.status ?? ""),
    };
  });

  const indexed = urls.filter((u) => u.indexed).length;
  const inspected = urls.filter((u) => u.lastInspection).length;

  const history = db
    .prepare(
      `SELECT snap_date AS date, indexed, not_indexed AS notIndexed, total_known AS total
         FROM index_snapshots WHERE site_id = ? ORDER BY snap_date`,
    )
    .all(siteId) as { date: string; indexed: number; notIndexed: number; total: number }[];

  const job = db.prepare("SELECT * FROM index_jobs WHERE site_id = ?").get(siteId) ?? null;

  return {
    total: urls.length,
    inspected,
    indexed,
    notIndexed: inspected - indexed,
    pctIndexed: urls.length ? Math.round((indexed / urls.length) * 100) : 0,
    submittableCount: urls.filter((u) => u.submittable).length,
    urls,
    history,
    job,
    quotaLeft: quotaLeft(siteId),
    dailyCap: DAILY_CAP,
    indexing: {
      // Available for any signed-in user (via OAuth); a service account is optional.
      configured: true,
      serviceAccount: serviceAccountConfigured(),
    },
  };
}

// ---------- submit to Google Indexing API ----------

export async function submitUrls(
  site: SiteRow,
  urls: string[],
  userToken?: string,
): Promise<{ url: string; ok: boolean; message: string }[]> {
  const out: { url: string; ok: boolean; message: string }[] = [];
  const mark = db.prepare(
    "UPDATE url_inspections SET submitted_at = ?, submit_result = ? WHERE site_id = ? AND url = ?",
  );
  const ensureRow = db.prepare(
    `INSERT INTO url_inspections (site_id, url, inspected_at, in_sitemap)
     VALUES (?, ?, 0, 1) ON CONFLICT(site_id, url) DO NOTHING`,
  );
  for (const url of urls) {
    try {
      await publishUrl(url, { userToken });
      ensureRow.run(site.id, url);
      mark.run(Date.now(), "ok", site.id, url);
      out.push({ url, ok: true, message: "submitted" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      ensureRow.run(site.id, url);
      mark.run(Date.now(), message.slice(0, 200), site.id, url);
      out.push({ url, ok: false, message });
    }
  }
  return out;
}
