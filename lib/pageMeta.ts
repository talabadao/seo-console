// Thumbnails for Search Console's "Your content" list: the page's og:image, else the image of its article
// JSON-LD, else nothing (the UI shows a neutral icon). There is no CMS connection yet; when one exists its
// mapping goes first (resolveThumbnail's `cms` hook).
//
// Fetching is guarded: only pages on the project's own site (checked by the caller and here), http(s) only,
// every host resolved and refused unless all its addresses are public (no loopback, private, link-local,
// carrier-grade NAT or multicast ranges), redirects followed by hand (at most 3, each re-checked), 8-second
// timeout, at most 512 KB of HTML read, at most 4 pages at once per server instance. Results — including
// "no image" and failures — are saved for 7 days in page_meta (migration 0011) and shared by every instance;
// an explicit refresh refetches. Images themselves are not fetched by the server: the browser lazy-loads them.

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { db, tableExists } from "@/lib/db";
import { Semaphore } from "@/lib/ga4";

export const META_TTL_MS = 7 * 24 * 3600_000;
export const ERROR_TTL_MS = 24 * 3600_000;
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const gate = new Semaphore(4);

export interface PageThumb {
  url: string;
  image: string | null;
  source: "cms" | "og" | "jsonld" | "none" | "error";
  fetchedAt: number;
}

const hash = (url: string) => createHash("sha256").update(url).digest("hex");

// --- Address checks --------------------------------------------------------------------------------------

function v4Public(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && ip.split(".")[2] === "0"))) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return true;
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return v4Public(ip);
  if (v !== 6) return false;
  const x = ip.toLowerCase();
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Public(mapped[1]);
  if (x === "::" || x === "::1") return false;
  if (/^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x)) return false;
  return true;
}

export class UnsafeUrl extends Error {}

type Resolve = (host: string) => Promise<string[]>;
const dnsResolve: Resolve = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Throws UnsafeUrl unless the URL is http(s) on a host whose every address is public. */
export async function assertPublicUrl(raw: string, resolve: Resolve = dnsResolve): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrl("Not a URL.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new UnsafeUrl("Only http and https pages are read.");
  if (u.username || u.password) throw new UnsafeUrl("URLs with credentials aren't read.");
  if (u.port && u.port !== "80" && u.port !== "443") throw new UnsafeUrl("Only the standard web ports are read.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (!addrs.length) throw new UnsafeUrl("The host doesn't resolve.");
  if (!addrs.every(isPublicAddress)) throw new UnsafeUrl("The host resolves to a private or reserved address.");
  return u;
}

const siteHost = (url: string) => {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/** A page belongs to the project's site when its host is the site's host or a subdomain of it. */
export function onSite(pageUrl: string, website: string): boolean {
  const site = siteHost(website);
  const host = siteHost(pageUrl);
  return Boolean(site && host) && (host === site || host.endsWith(`.${site}`));
}

// --- Fetch and parse -------------------------------------------------------------------------------------

/** Reads up to MAX_BYTES of an HTML page (following ≤3 checked redirects that stay on the project's site). */
export async function fetchHtml(url: string, website: string, opts: { resolve?: Resolve; fetchImpl?: typeof fetch } = {}): Promise<{ html: string; finalUrl: string }> {
  const doFetch = opts.fetchImpl ?? fetch;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!onSite(current, website)) throw new UnsafeUrl("The page redirects off the project's site.");
    await assertPublicUrl(current, opts.resolve);
    const res = await doFetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "SEO-Console-Thumbnails/1.0 (+read-only)" },
      cache: "no-store",
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!loc) throw new Error(`HTTP ${res.status} without a location`);
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    const type = res.headers.get("content-type") ?? "";
    if (type && !/html|xml/i.test(type)) {
      await res.body?.cancel().catch(() => {});
      throw new Error("Not an HTML page");
    }
    const reader = res.body?.getReader();
    if (!reader) return { html: "", finalUrl: current };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      // Everything needed is in <head>; stop at the size limit or once the head has closed.
      if (size >= MAX_BYTES || /<\/head>/i.test(new TextDecoder().decode(value))) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    const buf = new Uint8Array(Math.min(size, MAX_BYTES));
    let off = 0;
    for (const c of chunks) {
      const take = Math.min(c.byteLength, buf.byteLength - off);
      buf.set(c.subarray(0, take), off);
      off += take;
      if (off >= buf.byteLength) break;
    }
    return { html: new TextDecoder().decode(buf), finalUrl: current };
  }
  throw new Error("Too many redirects");
}

const decodeEntities = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

const absolute = (src: string, base: string): string | null => {
  try {
    const u = new URL(decodeEntities(src.trim()), base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
};

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? null) : null;
}

function jsonLdImage(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = jsonLdImage(n);
      if (r) return r;
    }
    return null;
  }
  const o = node as Record<string, unknown>;
  if (o["@graph"]) {
    const r = jsonLdImage(o["@graph"]);
    if (r) return r;
  }
  const types = ([] as unknown[]).concat(o["@type"] ?? []).map(String);
  if (types.some((t) => /^(Article|BlogPosting|NewsArticle|TechArticle|Report|WebPage|Product|Hotel|LodgingBusiness)$/.test(t))) {
    const img = o.image ?? o.thumbnailUrl;
    const first = Array.isArray(img) ? img[0] : img;
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && typeof (first as Record<string, unknown>).url === "string") return (first as Record<string, string>).url;
  }
  return null;
}

/** og:image (or og:image:secure_url), else the article JSON-LD image. Relative URLs resolve against the page. */
export function extractThumbnail(html: string, pageUrl: string): { image: string; source: "og" | "jsonld" } | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const prop = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
    if (prop === "og:image" || prop === "og:image:secure_url" || prop === "og:image:url") {
      const content = attr(tag, "content");
      const abs = content ? absolute(content, pageUrl) : null;
      if (abs) return { image: abs, source: "og" };
    }
  }
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const img = jsonLdImage(JSON.parse(m[1].trim()));
      const abs = img ? absolute(img, pageUrl) : null;
      if (abs) return { image: abs, source: "jsonld" };
    } catch {
      // Invalid JSON-LD: ignore this block.
    }
  }
  return null;
}

// --- Cache -----------------------------------------------------------------------------------------------

export const pageMetaReady = () => tableExists("page_meta");

/**
 * Thumbnails for pages of one project's site: saved results within 7 days, else fetched (bounded). `refresh`
 * refetches. Pages off the site are refused without any request.
 */
export async function thumbnails(
  urls: string[],
  website: string,
  opts: { refresh?: boolean; now?: number; resolve?: Resolve; fetchImpl?: typeof fetch; cms?: (url: string) => Promise<string | null> } = {},
): Promise<PageThumb[]> {
  const now = opts.now ?? Date.now();
  const unique = [...new Set(urls)].slice(0, 25);
  return Promise.all(
    unique.map(async (url): Promise<PageThumb> => {
      if (!onSite(url, website)) return { url, image: null, source: "error", fetchedAt: now };
      const key = hash(url);
      if (!opts.refresh) {
        // Misses ("no image") keep for 7 days like hits; failed fetches are retried after a day.
        const hit = (await db
          .prepare("SELECT image, source, fetched_at FROM page_meta WHERE url_hash = ? AND fetched_at > (CASE WHEN source = 'error' THEN ?::bigint ELSE ?::bigint END)")
          .get(key, now - ERROR_TTL_MS, now - META_TTL_MS)) as
          | { image: string | null; source: PageThumb["source"]; fetched_at: number }
          | undefined;
        if (hit) return { url, image: hit.image, source: hit.source, fetchedAt: Number(hit.fetched_at) };
      }
      let out: PageThumb;
      try {
        const cms = opts.cms ? await opts.cms(url) : null;
        if (cms) out = { url, image: cms, source: "cms", fetchedAt: now };
        else {
          const { html, finalUrl } = await gate.run(() => fetchHtml(url, website, opts));
          const found = extractThumbnail(html, finalUrl);
          out = { url, image: found?.image ?? null, source: found?.source ?? "none", fetchedAt: now };
        }
      } catch {
        out = { url, image: null, source: "error", fetchedAt: now };
      }
      await db
        .prepare(
          `INSERT INTO page_meta (url_hash, url, image, source, fetched_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (url_hash) DO UPDATE SET image = EXCLUDED.image, source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at`,
        )
        .run(key, url.slice(0, 2000), out.image, out.source, out.fetchedAt);
      return out;
    }),
  );
}
