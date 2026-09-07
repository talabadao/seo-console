const WMX = "https://www.googleapis.com/webmasters/v3";
const INSPECT = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export interface SearchAnalyticsRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export type SearchType = "web" | "image" | "video" | "news" | "discover" | "googleNews";

async function gfetch(url: string, token: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google API ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

export async function listSites(token: string): Promise<GscSite[]> {
  const data = await gfetch(`${WMX}/sites`, token);
  return (data.siteEntry ?? []) as GscSite[];
}

export interface SearchAnalyticsQuery {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  type?: SearchType;
  rowLimit?: number;
  startRow?: number;
  dataState?: "all" | "final";
  dimensionFilterGroups?: unknown[];
}

const PAGE = 25000; // GSC hard maximum per request

export async function searchAnalytics(
  token: string,
  siteUrl: string,
  query: SearchAnalyticsQuery,
): Promise<SearchAnalyticsRow[]> {
  const data = await gfetch(
    `${WMX}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    token,
    { method: "POST", body: JSON.stringify(query) },
  );
  return (data.rows ?? []) as SearchAnalyticsRow[];
}

/**
 * Paginates past the 1,000-row default. Pulls in 25k pages until a short page
 * comes back or `maxRows` is reached.
 */
export async function searchAnalyticsAll(
  token: string,
  siteUrl: string,
  query: Omit<SearchAnalyticsQuery, "rowLimit" | "startRow">,
  maxRows = 50000,
): Promise<SearchAnalyticsRow[]> {
  const out: SearchAnalyticsRow[] = [];
  for (let startRow = 0; startRow < maxRows; startRow += PAGE) {
    const rows = await searchAnalytics(token, siteUrl, {
      ...query,
      rowLimit: Math.min(PAGE, maxRows - startRow),
      startRow,
    });
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// ---- Sitemaps API ----

export interface GscSitemap {
  path: string;
  lastSubmitted?: string;
  lastDownloaded?: string;
  isPending?: boolean;
  isSitemapsIndex?: boolean;
  warnings?: string;
  errors?: string;
  contents?: { type: string; submitted: string; indexed: string }[];
}

export async function listSitemaps(token: string, siteUrl: string): Promise<GscSitemap[]> {
  const data = await gfetch(
    `${WMX}/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
    token,
  );
  return (data.sitemap ?? []) as GscSitemap[];
}

// ---- URL Inspection ----

export interface UrlInspectionResult {
  inspectionResultLink?: string;
  indexStatusResult?: {
    verdict?: string;
    coverageState?: string;
    robotsTxtState?: string;
    indexingState?: string;
    lastCrawlTime?: string;
    pageFetchState?: string;
    googleCanonical?: string;
    userCanonical?: string;
    crawledAs?: string;
    sitemap?: string[];
    referringUrls?: string[];
  };
  richResultsResult?: { verdict?: string; detectedItems?: { richResultType?: string }[] };
  mobileUsabilityResult?: { verdict?: string };
}

export async function inspectUrl(
  token: string,
  siteUrl: string,
  inspectionUrl: string,
): Promise<UrlInspectionResult> {
  const data = await gfetch(INSPECT, token, {
    method: "POST",
    body: JSON.stringify({ siteUrl, inspectionUrl, languageCode: "en-US" }),
  });
  return (data.inspectionResult ?? {}) as UrlInspectionResult;
}
