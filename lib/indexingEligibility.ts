// Google's Indexing API is supported only for pages that carry JobPosting
// structured data, or a livestream: a VideoObject whose `publication` is a
// BroadcastEvent. https://developers.google.com/search/apis/indexing-api/v3/quickstart
//
// Eligibility is read from the page's own structured data, fetched live: the
// URL's path or wording never decides it. Ineligible pages are not submitted
// and use no quota; URL Inspection is unaffected.

import { hostOf } from "@/lib/projectMatch";

export type EligibleType = "JobPosting" | "BroadcastEvent";

export interface Eligibility {
  eligible: boolean;
  types: EligibleType[];
  /** Why the page isn't eligible, or why it couldn't be checked. */
  reason: string | null;
}

type Node = Record<string, unknown>;

const typesOf = (n: Node): string[] => {
  const t = n["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string").map((x) => x.replace(/^.*[/#]/, ""));
};

/** Visits every object in a JSON-LD value, including @graph members and nested properties. */
function walk(value: unknown, visit: (n: Node) => void, depth = 0): void {
  if (depth > 12 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) walk(v, visit, depth + 1);
    return;
  }
  visit(value as Node);
  for (const v of Object.values(value as Node)) walk(v, visit, depth + 1);
}

/** Eligible structured-data types declared in a page's HTML (JSON-LD and microdata). */
export function eligibleTypesIn(html: string): EligibleType[] {
  const found = new Set<EligibleType>();

  const scripts = html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, body] of scripts) {
    let data: unknown;
    try {
      data = JSON.parse(body.trim());
    } catch {
      continue; // malformed block: Google ignores it too
    }
    walk(data, (n) => {
      const types = typesOf(n);
      if (types.includes("JobPosting")) found.add("JobPosting");
      if (types.includes("VideoObject")) {
        const pubs = Array.isArray(n.publication) ? n.publication : [n.publication];
        if (pubs.some((p) => p && typeof p === "object" && typesOf(p as Node).includes("BroadcastEvent"))) {
          found.add("BroadcastEvent");
        }
      }
    });
  }

  // Microdata: itemtype="https://schema.org/JobPosting". A BroadcastEvent in
  // microdata must sit inside a VideoObject's publication property.
  if (/itemtype\s*=\s*["']https?:\/\/schema\.org\/JobPosting["']/i.test(html)) found.add("JobPosting");
  if (
    /itemtype\s*=\s*["']https?:\/\/schema\.org\/VideoObject["'][\s\S]*?itemprop\s*=\s*["']publication["'][^>]*itemtype\s*=\s*["']https?:\/\/schema\.org\/BroadcastEvent["']/i.test(
      html,
    )
  ) {
    found.add("BroadcastEvent");
  }

  return [...found];
}

/**
 * Whether `url` belongs to the Search Console property: same host for a URL
 * prefix property, the domain or a subdomain for a domain property. Pages are
 * only ever fetched on the property's own site.
 */
export function urlBelongsToProperty(url: string, property: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  const propHost = hostOf(property);
  if (!propHost) return false;
  if (property.startsWith("sc-domain:")) return host === propHost || host.endsWith(`.${propHost}`);
  return host === propHost && url.startsWith(property.replace(/\/?$/, "/").slice(0, -1));
}

const MAX_BYTES = 2_000_000;

/** Fetches the page (on the property's own site only) and reads its structured data. */
export async function checkEligibility(url: string, property: string): Promise<Eligibility> {
  if (!urlBelongsToProperty(url, property)) {
    return { eligible: false, types: [], reason: "not on this Search Console property" };
  }
  let current = url;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(current, {
        redirect: "manual",
        headers: { "User-Agent": "SEO-Console/0.1 (+structured-data check)", Accept: "text/html" },
        signal: AbortSignal.timeout(10_000),
      });
      const next = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && next) {
        current = new URL(next, current).toString();
        // Redirects may not leave the property, and the Indexing API should be
        // given the final URL anyway.
        if (!urlBelongsToProperty(current, property)) {
          return { eligible: false, types: [], reason: "redirects off the property" };
        }
        continue;
      }
      if (!res.ok) return { eligible: false, types: [], reason: `page returned HTTP ${res.status}` };
      const body = await readCapped(res);
      const types = eligibleTypesIn(body);
      return types.length
        ? { eligible: true, types, reason: null }
        : { eligible: false, types, reason: "no JobPosting or livestream (BroadcastEvent) structured data" };
    }
    return { eligible: false, types: [], reason: "too many redirects" };
  } catch (e) {
    return {
      eligible: false,
      types: [],
      reason: /abort|timeout/i.test(String(e)) ? "page took too long to load" : "page couldn't be fetched",
    };
  }
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
}
