// Bing Webmaster Tools API client.
// Docs: https://learn.microsoft.com/en-us/bingwebmaster/getting-access
// Activated once the user saves a Bing API key (Settings page). Until then every
// call throws BingNotConfigured and the UI hides Bing panels.
//
// The Bing WMT API is JSON over GET/POST with ?apikey=... . Unlike Google it does
// not need per-user OAuth, so one org-wide key covers every verified site.

const BASE = "https://ssl.bing.com/webmaster/api.svc/json";

export class BingNotConfigured extends Error {
  constructor() {
    super("Bing Webmaster API key not configured");
    this.name = "BingNotConfigured";
  }
}

async function bfetch(method: string, apiKey: string, params: Record<string, string> = {}) {
  if (!apiKey) throw new BingNotConfigured();
  const qs = new URLSearchParams({ apikey: apiKey, ...params });
  const res = await fetch(`${BASE}/${method}?${qs}`);
  if (!res.ok) throw new Error(`Bing API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return json.d;
}

export async function getUserSites(apiKey: string): Promise<string[]> {
  const d = await bfetch("GetUserSites", apiKey);
  return (d ?? []).map((s: { Url: string }) => s.Url);
}

export interface BingRankRow {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** GetRankAndTrafficStats -> daily clicks/impressions for a site. */
export async function getTrafficStats(apiKey: string, siteUrl: string): Promise<BingRankRow[]> {
  const d = await bfetch("GetRankAndTrafficStats", apiKey, { siteUrl });
  return (d ?? []).map((r: Record<string, number | string>) => ({
    date: bingDate(r.Date as string),
    clicks: Number(r.Clicks ?? 0),
    impressions: Number(r.Impressions ?? 0),
    ctr: Number(r.Impressions) ? Number(r.Clicks) / Number(r.Impressions) : 0,
    position: Number(r.AvgImpressionPosition ?? 0),
  }));
}

export async function getCrawlStats(apiKey: string, siteUrl: string) {
  return bfetch("GetCrawlStats", apiKey, { siteUrl });
}

export async function getCrawlIssues(apiKey: string, siteUrl: string) {
  return bfetch("GetCrawlIssues", apiKey, { siteUrl });
}

// Bing serializes dates as "/Date(1690000000000)/"
function bingDate(s: string): string {
  const m = /\/Date\((\d+)\)\//.exec(s);
  const d = m ? new Date(Number(m[1])) : new Date(s);
  return d.toISOString().slice(0, 10);
}
