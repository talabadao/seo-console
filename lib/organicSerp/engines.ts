// Organic SERP engines (Rank tracking → Organic SERP) through SerpApi: which controls each engine accepts, how a
// form becomes request parameters, how results pages are counted (each page is one billed SerpApi search), and
// how responses are normalized. Pure: no network or database, so the page can show engine-valid controls and
// the expected usage before anything is sent. Parameters follow SerpApi's docs for each engine (Oct 2026).

export type EngineId = "google" | "bing" | "yandex" | "naver";
export type Field = "location" | "country" | "language" | "device" | "yandexDomain" | "region";

export interface EngineSpec {
  id: EngineId;
  label: string;
  /** Form fields this engine accepts; nothing else is shown or sent. */
  fields: Field[];
  /** Depths offered (results to scan). */
  depths: number[];
  /** Results per billed page used to estimate cost (an upper bound on requests; the run stops early when done). */
  pageSize: number;
  note: string;
}

export const ENGINES: Record<EngineId, EngineSpec> = {
  google: {
    id: "google",
    label: "Google",
    fields: ["location", "country", "language", "device"],
    depths: [10, 20, 30, 50],
    pageSize: 10,
    note: "10 results per page; each page is one SerpApi search.",
  },
  bing: {
    id: "bing",
    label: "Bing",
    fields: ["location", "country", "device"],
    depths: [10, 20, 30, 50],
    pageSize: 10,
    note: "About 10 results per page; each page is one SerpApi search.",
  },
  yandex: {
    id: "yandex",
    label: "Yandex",
    fields: ["yandexDomain", "language", "region"],
    depths: [10, 20, 30, 50],
    pageSize: 10,
    note: "Pages vary in length; each page is one SerpApi search. Yandex has no device setting.",
  },
  naver: {
    id: "naver",
    label: "Naver",
    fields: ["device"],
    depths: [10, 20, 30],
    pageSize: 10,
    note: "Naver web results; each page is one SerpApi search. Naver has no location or language setting.",
  },
};

export const ENGINE_IDS = Object.keys(ENGINES) as EngineId[];
export const isEngine = (v: unknown): v is EngineId => typeof v === "string" && v in ENGINES;

export const YANDEX_DOMAINS = ["yandex.com", "yandex.ru", "yandex.com.tr", "yandex.kz", "yandex.by", "yandex.uz"];
export const DEVICES = ["desktop", "tablet", "mobile"] as const;

export interface SerpParams {
  query: string;
  location?: string;
  /** Two-letter country code (Google gl, Bing cc). */
  country?: string;
  /** Language code (Google hl, Yandex lang). */
  language?: string;
  device?: (typeof DEVICES)[number];
  yandexDomain?: string;
  /** Yandex region id (lr). */
  region?: string;
}

export interface SerpInput {
  engine: EngineId;
  params: SerpParams;
  depth: number;
  /** Stop paging once the tracked domain is found (saves searches). */
  stopOnFound: boolean;
}

export class SerpInputError extends Error {}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Validates a form for its engine, keeping only that engine's fields. Throws SerpInputError. */
export function normalizeInput(raw: { engine?: unknown; params?: unknown; depth?: unknown; stopOnFound?: unknown }): SerpInput {
  if (!isEngine(raw.engine)) throw new SerpInputError("Choose Google, Bing, Yandex or Naver.");
  const spec = ENGINES[raw.engine];
  const p = (raw.params && typeof raw.params === "object" ? raw.params : {}) as Record<string, unknown>;
  const query = clean(p.query, 300);
  if (!query) throw new SerpInputError("Enter a keyword.");
  const depth = Number(raw.depth);
  if (!spec.depths.includes(depth)) throw new SerpInputError(`Depth must be one of ${spec.depths.join(", ")} for ${spec.label}.`);
  const out: SerpParams = { query };
  for (const f of spec.fields) {
    const v = clean(p[f], 120);
    if (!v) continue;
    if (f === "country" && !/^[a-z]{2}$/i.test(v)) throw new SerpInputError("Country must be a two-letter code, e.g. vn or us.");
    if (f === "language" && !/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(v)) throw new SerpInputError("Language must be a code such as en, vi or zh-tw.");
    if (f === "device" && !(DEVICES as readonly string[]).includes(v)) throw new SerpInputError("Device must be desktop, tablet or mobile.");
    if (f === "yandexDomain" && !YANDEX_DOMAINS.includes(v)) throw new SerpInputError(`Yandex domain must be one of ${YANDEX_DOMAINS.join(", ")}.`);
    if (f === "region" && !/^\d{1,6}$/.test(v)) throw new SerpInputError("Yandex region must be a numeric region id (lr).");
    (out as unknown as Record<string, string>)[f] = f === "country" || f === "language" ? v.toLowerCase() : v;
  }
  return { engine: raw.engine, params: out, depth, stopOnFound: raw.stopOnFound !== false };
}

/** The most SerpApi searches a run can use (one per page). */
export const maxRequests = (engine: EngineId, depth: number) => Math.ceil(depth / ENGINES[engine].pageSize);

/** SerpApi parameters for one results page (page is 1-based). Never includes the API key. */
export function requestParams(input: SerpInput, page: number): Record<string, string> {
  const p = input.params;
  const set = (o: Record<string, string>, k: string, v: string | undefined) => {
    if (v) o[k] = v;
  };
  const o: Record<string, string> = { engine: input.engine };
  switch (input.engine) {
    case "google":
      o.q = p.query;
      set(o, "location", p.location);
      set(o, "gl", p.country);
      set(o, "hl", p.language);
      set(o, "device", p.device);
      if (page > 1) o.start = String((page - 1) * 10);
      break;
    case "bing":
      o.q = p.query;
      set(o, "location", p.location);
      set(o, "cc", p.country);
      set(o, "device", p.device);
      if (page > 1) o.first = String((page - 1) * 10 + 1);
      break;
    case "yandex":
      o.text = p.query;
      set(o, "yandex_domain", p.yandexDomain);
      set(o, "lang", p.language);
      set(o, "lr", p.region);
      if (page > 1) o.p = String(page - 1);
      break;
    case "naver":
      o.query = p.query;
      set(o, "device", p.device);
      if (page > 1) o.page = String(page);
      break;
  }
  return o;
}

export interface SerpResult {
  /** 1-based across pages (SerpApi restarts numbering on each page). */
  position: number;
  title: string;
  url: string;
  displayedUrl: string | null;
  domain: string;
  snippet: string | null;
}

/** Top-level response keys that mean a SERP feature is on the page (first page only). */
const FEATURE_KEYS: Record<string, string> = {
  ai_overview: "AI Overview",
  answer_box: "Answer box",
  knowledge_graph: "Knowledge panel",
  local_results: "Local pack",
  local_map: "Map",
  top_stories: "Top stories",
  related_questions: "People also ask",
  inline_videos: "Videos",
  inline_images: "Images",
  shopping_results: "Shopping",
  inline_shopping: "Shopping",
  ads: "Ads",
  discussions_and_forums: "Discussions and forums",
  recipes_results: "Recipes",
  twitter_results: "X posts",
  related_searches: "Related searches",
  news_results: "News",
  video_results: "Videos",
  image_results: "Images",
  places_results: "Places",
};

export function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** A result belongs to the tracked site when its host is the site's host or a subdomain of it. */
export const belongsTo = (domain: string, site: string) => Boolean(domain && site) && (domain === site || domain.endsWith(`.${site}`));

/** Organic results on one page, in order, before renumbering. */
export function pageResults(engine: EngineId, body: Record<string, unknown>): Array<Omit<SerpResult, "position">> {
  const list = (engine === "naver" ? (body.web_results ?? body.organic_results) : body.organic_results) as unknown;
  if (!Array.isArray(list)) return [];
  return list
    .map((r: Record<string, unknown>) => {
      const url = typeof r.link === "string" ? r.link : "";
      return {
        title: typeof r.title === "string" ? r.title : url,
        url,
        displayedUrl: typeof r.displayed_link === "string" ? r.displayed_link : null,
        domain: hostOf(url),
        snippet: typeof r.snippet === "string" ? r.snippet : null,
      };
    })
    .filter((r) => r.url);
}

export function pageFeatures(body: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const [k, label] of Object.entries(FEATURE_KEYS)) {
    const v = body[k];
    if (v && (!Array.isArray(v) || v.length)) out.add(label);
  }
  return [...out];
}

/** Whether SerpApi says there's another page. */
export function hasNextPage(body: Record<string, unknown>): boolean {
  const pag = (body.serpapi_pagination ?? body.pagination) as Record<string, unknown> | undefined;
  return Boolean(pag && (pag.next || pag.next_link));
}

export interface SnapshotDiffRow {
  url: string;
  domain: string;
  title: string;
  a: number | null;
  b: number | null;
  /** Positions gained from A to B (positive = moved up); null when either side is missing. */
  change: number | null;
  tracked: boolean;
}

/** Compares two snapshots of the same search by URL (A = older, B = newer). */
export function diffSnapshots(a: SerpResult[], b: SerpResult[], trackedDomain: string | null): SnapshotDiffRow[] {
  const key = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "").toLowerCase();
  const rows = new Map<string, SnapshotDiffRow>();
  for (const r of a) rows.set(key(r.url), { url: r.url, domain: r.domain, title: r.title, a: r.position, b: null, change: null, tracked: false });
  for (const r of b) {
    const k = key(r.url);
    const row = rows.get(k) ?? { url: r.url, domain: r.domain, title: r.title, a: null, b: null, change: null, tracked: false };
    row.b = r.position;
    row.title = r.title || row.title;
    rows.set(k, row);
  }
  for (const row of rows.values()) {
    row.change = row.a != null && row.b != null ? row.a - row.b : null;
    row.tracked = trackedDomain ? belongsTo(row.domain, trackedDomain) : false;
  }
  return [...rows.values()].sort((x, y) => (x.b ?? 1e9) - (y.b ?? 1e9) || (x.a ?? 1e9) - (y.a ?? 1e9));
}
