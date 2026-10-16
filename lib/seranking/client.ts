/**
 * SE Ranking API client, adapted from the AI Brand Mention app (src/lib/seranking/client.ts).
 * The key is read from SERANKING_API_KEY on the server and sent only in the Authorization header — never in URLs,
 * logs or errors. Unlike the donor there is no generated-data fallback: without a key, callers report
 * "not configured".
 */

import { ProviderBusyError, providerFetch } from "@/lib/sync/providerHttp";
import { keyFingerprint } from "@/lib/providers/ledger";

const BASE_URL = "https://api.seranking.com/v1/";
/** SE Ranking allows 5 requests per second per API key; the window is shared by every server instance. */
const RATE = { max: 5, windowMs: 1000 };
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
  let res: Response;
  try {
    res = await providerFetch({
      provider: "seranking",
      bucket: `seranking:key:${keyFingerprint(key)}`,
      limit: RATE,
      url,
      timeoutMs: TIMEOUT_MS,
      init: { headers: { Authorization: `Token ${key}`, Accept: "application/json" } },
    });
  } catch (err) {
    if (err instanceof ProviderBusyError) throw err;
    throw new SeRankingError(0, err instanceof Error && err.name === "TimeoutError" ? "SE Ranking did not respond in time" : "Could not reach SE Ranking");
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
  throw new SeRankingError(res.status, `SE Ranking ${path}: ${message}`.slice(0, 300));
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

