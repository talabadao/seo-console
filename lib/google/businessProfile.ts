// Google Business Profile APIs. Reading reviews still goes through the v4
// "My Business" endpoint; accounts and locations have their own newer APIs.
// All three must be enabled in the Cloud project, and the sign-in must carry
// the business.manage scope.

const ACCOUNTS = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
const V4 = "https://mybusiness.googleapis.com/v4";

/** Thrown for failures the UI should explain rather than show raw. */
export class BusinessProfileError extends Error {
  constructor(
    message: string,
    public enableUrl: string | null = null,
  ) {
    super(message);
  }
}

async function gfetch<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.ok) return (await res.json()) as T;
  const body = await res.text();
  let msg = body.slice(0, 300);
  let enableUrl: string | null = null;
  try {
    const err = JSON.parse(body)?.error;
    msg = err?.message ?? msg;
    for (const d of err?.details ?? []) {
      const link = d?.links?.[0]?.url ?? d?.metadata?.activationUrl;
      if (link) enableUrl = link;
    }
  } catch {
    /* not JSON */
  }
  if (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(msg)) {
    const api = /([A-Za-z ]+ API)/.exec(msg)?.[1] ?? "A Business Profile API";
    throw new BusinessProfileError(`${api} isn't enabled in your Google Cloud project.`, enableUrl);
  }
  if (res.status === 429 || /quota/i.test(msg)) {
    throw new BusinessProfileError(
      "Google Business Profile API quota is exhausted (a quota of 0 means Google hasn't approved API access for this Cloud project yet).",
    );
  }
  if (res.status === 403) {
    throw new BusinessProfileError("This Google account doesn't have access to that Business Profile.");
  }
  throw new BusinessProfileError(`Google Business Profile ${res.status}: ${msg}`);
}

export interface GbpLocation {
  /** Full resource path used for reviews: "accounts/123/locations/456". */
  name: string;
  title: string;
  address: string;
  accountName: string;
  websiteUri: string;
}

/** Every location in every Business Profile account this sign-in can manage. */
export async function listLocations(token: string): Promise<GbpLocation[]> {
  const accounts: { name: string; accountName?: string }[] = [];
  let pageToken = "";
  do {
    const j = await gfetch<{ accounts?: { name: string; accountName?: string }[]; nextPageToken?: string }>(
      `${ACCOUNTS}?pageSize=20${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      token,
    );
    accounts.push(...(j.accounts ?? []));
    pageToken = j.nextPageToken ?? "";
  } while (pageToken);

  const out: GbpLocation[] = [];
  for (const account of accounts) {
    let next = "";
    do {
      const qs = new URLSearchParams({
        readMask: "name,title,storefrontAddress,websiteUri",
        pageSize: "100",
      });
      if (next) qs.set("pageToken", next);
      const j = await gfetch<{
        locations?: {
          name: string;
          title?: string;
          websiteUri?: string;
          storefrontAddress?: { addressLines?: string[]; locality?: string; regionCode?: string };
        }[];
        nextPageToken?: string;
      }>(`${INFO}/${account.name}/locations?${qs}`, token);
      for (const l of j.locations ?? []) {
        const a = l.storefrontAddress;
        out.push({
          name: `${account.name}/${l.name}`,
          title: l.title ?? l.name,
          address: [...(a?.addressLines ?? []), a?.locality, a?.regionCode].filter(Boolean).join(", "),
          accountName: account.accountName ?? "",
          websiteUri: l.websiteUri ?? "",
        });
      }
      next = j.nextPageToken ?? "";
    } while (next);
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export interface GbpReview {
  reviewId: string;
  reviewerName: string;
  star: number;
  comment: string;
  createTime: number;
  updateTime: number;
  replyComment: string | null;
  replyTime: number | null;
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

interface RawReview {
  reviewId: string;
  reviewer?: { displayName?: string };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
}

/**
 * All reviews for a location, newest first. `maxPages` bounds the work (50
 * reviews a page); `stopBefore` ends early once a page is entirely older than
 * that time, for cheap incremental refreshes.
 */
export async function listReviews(
  token: string,
  location: string,
  opts: { maxPages?: number; stopBefore?: number } = {},
): Promise<{ reviews: GbpReview[]; averageRating: number | null; totalReviewCount: number | null }> {
  const reviews: GbpReview[] = [];
  let averageRating: number | null = null;
  let totalReviewCount: number | null = null;
  let pageToken = "";
  for (let page = 0; page < (opts.maxPages ?? 100); page++) {
    const qs = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc" });
    if (pageToken) qs.set("pageToken", pageToken);
    const j = await gfetch<{
      reviews?: RawReview[];
      averageRating?: number;
      totalReviewCount?: number;
      nextPageToken?: string;
    }>(`${V4}/${location}/reviews?${qs}`, token);
    averageRating = j.averageRating ?? averageRating;
    totalReviewCount = j.totalReviewCount ?? totalReviewCount;
    const batch = (j.reviews ?? []).map((r) => {
      const createTime = r.createTime ? Date.parse(r.createTime) : 0;
      return {
        reviewId: r.reviewId,
        reviewerName: r.reviewer?.displayName ?? "",
        star: STARS[r.starRating ?? ""] ?? 0,
        comment: r.comment ?? "",
        createTime,
        updateTime: r.updateTime ? Date.parse(r.updateTime) : createTime,
        replyComment: r.reviewReply?.comment ?? null,
        replyTime: r.reviewReply?.updateTime ? Date.parse(r.reviewReply.updateTime) : null,
      };
    });
    reviews.push(...batch);
    pageToken = j.nextPageToken ?? "";
    if (!pageToken) break;
    if (opts.stopBefore && batch.length && batch.every((r) => r.updateTime < opts.stopBefore!)) break;
  }
  return { reviews, averageRating, totalReviewCount };
}
