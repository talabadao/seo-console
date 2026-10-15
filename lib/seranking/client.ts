/**
 * SE Ranking API client, adapted from the AI Brand Mention app (src/lib/seranking/client.ts).
 * The key is read from SERANKING_API_KEY on the server and sent only in the Authorization header — never in URLs,
 * logs or errors. Unlike the donor there is no generated-data fallback: without a key, callers report
 * "not configured".
 */

const BASE_URL = "https://api.seranking.com/v1/";
/** SE Ranking allows 5 requests per second; requests start at least this far apart. */
const MIN_GAP_MS = 220;
const TIMEOUT_MS = 30_000;

export function seRankingKey(): string | null {
  return process.env.SERANKING_API_KEY?.trim() || null;
}

export class SeRankingError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "SeRankingError";
  }
}

type ParamValue = string | number | undefined | null | Array<string | number>;

let queue: Promise<void> = Promise.resolve();
let lastStart = 0;

/** Spaces request starts out to stay under the rate limit, across concurrent callers in this instance. */
function rateSlot(): Promise<void> {
  const turn = queue.then(async () => {
    const wait = lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = Date.now();
  });
  queue = turn.catch(() => {});
  return turn;
}

function buildQuery(params: Record<string, ParamValue>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) for (const v of value) q.append(key, String(v));
    else q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** GET an SE Ranking endpoint (path relative to /v1/). Retries rate-limit (429) and gateway errors with backoff. */
export async function seGet<T = unknown>(path: string, params: Record<string, ParamValue> = {}): Promise<T> {
  const key = seRankingKey();
  if (!key) throw new SeRankingError(401, "SE Ranking API key is not configured");
  const url = `${BASE_URL}${path}${buildQuery(params)}`;
  let lastError: SeRankingError | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await rateSlot();
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Token ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      lastError = new SeRankingError(0, err instanceof Error && err.name === "TimeoutError" ? "SE Ranking did not respond in time" : "Could not reach SE Ranking");
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      continue;
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (res.ok) return body as T;
    const message =
      (body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string" && (body as { message: string }).message) ||
      `HTTP ${res.status}`;
    lastError = new SeRankingError(res.status, `SE Ranking ${path}: ${message}`.slice(0, 300));
    if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw lastError;
  }
  throw lastError ?? new SeRankingError(0, "SE Ranking request failed");
}

/** List responses come as a bare array, or wrapped in `data` / `items`. */
export function asList<T = Record<string, unknown>>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const v = value as { data?: unknown; items?: unknown; list?: unknown };
    if (Array.isArray(v.data)) return v.data as T[];
    if (Array.isArray(v.items)) return v.items as T[];
    if (Array.isArray(v.list)) return v.list as T[];
  }
  return [];
}

/** Numbers sometimes arrive as strings ("88", "+25"); null/blank stay null. */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/^\+/, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
}

