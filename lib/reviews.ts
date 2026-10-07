import { db, rawSql } from "@/lib/db";
import { classifierConfigured, classifyBatch, discoverAspects } from "@/lib/reviewClassify";
import {
  SerpApiError,
  creditsFor,
  findPlace,
  resolveMapsUrl,
  reviewsPage,
  searchesLeft,
  type MapsPlace,
} from "@/lib/serpapi";
import {
  starSentiment,
  type Review,
  type ReviewPoint,
  type ReviewsData,
  type Sentiment,
} from "@/lib/reviewTypes";

/** A project as the reviews code needs it. `placeRef` is null until its Maps link is resolved. */
export interface ReviewProject {
  id: number;
  name: string;
  mapsUrl: string;
  placeRef: string | null;
  placeTitle: string | null;
}

interface StateRow {
  average_rating: number | null;
  total_reviews: number | null;
  synced_at: number | null;
  sync_error: string | null;
  aspects_json: string | null;
  topics_json: string | null;
  address: string | null;
  place_type: string | null;
  credits_spent: number | null;
  next_token: string | null;
}

async function stateFor(projectId: number, location: string): Promise<StateRow | undefined> {
  return (await db
    .prepare(
      `SELECT average_rating, total_reviews, synced_at, sync_error, aspects_json, topics_json,
              address, place_type, credits_spent, next_token
         FROM gbp_state WHERE project_id = ? AND location = ?`,
    )
    .get(projectId, location)) as StateRow | undefined;
}

function parseList<T>(json: string | null | undefined): T[] {
  try {
    const a = JSON.parse(json ?? "[]");
    return Array.isArray(a) ? (a as T[]) : [];
  } catch {
    return [];
  }
}

async function savedCount(projectId: number, location: string): Promise<number> {
  const r = (await db
    .prepare("SELECT COUNT(*) AS n FROM gbp_reviews WHERE project_id = ? AND location = ?")
    .get(projectId, location)) as { n: number };
  return Number(r.n);
}

async function setPlaceRef(projectId: number, ref: string) {
  await db.prepare("UPDATE projects SET gbp_location = ? WHERE id = ?").run(ref, projectId);
}

/**
 * The place id for the project's Maps link, read from the link itself (free).
 * Null when the link carries no id — the first fetch then looks it up for one credit.
 */
export async function ensurePlaceRef(project: ReviewProject): Promise<string | null> {
  if (project.placeRef) return project.placeRef;
  const { ref } = await resolveMapsUrl(project.mapsUrl);
  if (ref) {
    await setPlaceRef(project.id, ref);
    project.placeRef = ref;
  }
  return ref;
}

export interface SyncResult {
  fetched: number;
  added: number;
  creditsUsed: number;
  /** False when the run stopped at the limit or the time budget with older reviews still unread. */
  complete: boolean;
}

/**
 * Fetches reviews from SerpApi, newest first, one credit per page.
 *
 * - "refresh" starts at the newest review and stops at the first page that
 *   holds nothing new, so an up-to-date place costs a single credit.
 * - "older" continues from where the deepest earlier run stopped, to extend
 *   history without paying again for pages already read.
 *
 * Both stop after `max` newly saved reviews or when the time budget runs out.
 */
export async function syncReviews(
  project: ReviewProject,
  key: string,
  opts: { mode: "refresh" | "older"; max: number; budgetMs: number },
): Promise<SyncResult> {
  const started = Date.now();
  let creditsUsed = 0;
  let location = project.placeRef;

  const spend = async (loc: string, extra: Record<string, unknown> = {}) => {
    const cols = Object.keys(extra);
    await db
      .prepare(
        `INSERT INTO gbp_state (project_id, location, credits_spent${cols.map((c) => `, ${c}`).join("")})
         VALUES (?, ?, 1${cols.map(() => ", ?").join("")})
         ON CONFLICT (project_id, location) DO UPDATE SET
           credits_spent = COALESCE(gbp_state.credits_spent, 0) + 1
           ${cols.map((c) => `, ${c} = EXCLUDED.${c}`).join("")}`,
      )
      .run(project.id, loc, ...Object.values(extra));
  };

  try {
    if (!location) {
      const { ref, finalUrl } = await resolveMapsUrl(project.mapsUrl);
      location = ref;
      if (!location) {
        location = await findPlace(key, finalUrl);
        creditsUsed++;
        if (!location) {
          throw new SerpApiError(
            "Couldn't find the business from that Google Maps link. Open the business in Google Maps, copy the link from the address bar, and save it in the project settings.",
          );
        }
        await spend(location);
      }
      await setPlaceRef(project.id, location);
      project.placeRef = location;
    }

    const state = await stateFor(project.id, location);
    const known = new Set(
      (
        (await db
          .prepare("SELECT review_id FROM gbp_reviews WHERE project_id = ? AND location = ?")
          .all(project.id, location)) as { review_id: string }[]
      ).map((r) => r.review_id),
    );

    let token: string | null = opts.mode === "older" ? (state?.next_token ?? null) : null;
    if (opts.mode === "older" && !token) return { fetched: 0, added: 0, creditsUsed, complete: true };

    const sql = await rawSql();
    let fetched = 0;
    let added = 0;
    let complete = false;
    let place: MapsPlace | null = null;
    // Only the first fetch and "older" runs read past everything saved so far,
    // so only they move the point a later "older" run continues from.
    const deepest = opts.mode === "older" || !state?.synced_at;

    for (let page = 0; ; page++) {
      if (page > 0 && (added >= opts.max || Date.now() - started > opts.budgetMs)) break;
      const res = await reviewsPage(key, location, token);
      creditsUsed++;
      place = res.place ?? place;
      fetched += res.reviews.length;

      const rows = res.reviews.map((r) => ({
        project_id: project.id,
        location,
        review_id: r.reviewId,
        reviewer_name: r.reviewerName,
        star: r.star,
        comment: r.original ?? r.english,
        source_en: r.original ? r.english : null,
        create_time: r.time,
        update_time: r.time,
        reply_comment: r.replyComment,
        reply_time: r.replyTime,
        link: r.link,
      }));
      const fresh = rows.filter((r) => !known.has(r.review_id));
      if (rows.length) {
        // No explicit VALUES keyword — see the note in lib/indexer.ts.
        await sql`
          INSERT INTO gbp_reviews ${sql(
            rows,
            "project_id",
            "location",
            "review_id",
            "reviewer_name",
            "star",
            "comment",
            "source_en",
            "create_time",
            "update_time",
            "reply_comment",
            "reply_time",
            "link",
          )}
          ON CONFLICT (project_id, location, review_id) DO UPDATE SET
            reviewer_name = EXCLUDED.reviewer_name,
            classified_at = CASE
              WHEN gbp_reviews.comment IS DISTINCT FROM EXCLUDED.comment OR gbp_reviews.star <> EXCLUDED.star
              THEN NULL ELSE gbp_reviews.classified_at END,
            star = EXCLUDED.star, comment = EXCLUDED.comment, source_en = EXCLUDED.source_en,
            reply_comment = EXCLUDED.reply_comment, reply_time = EXCLUDED.reply_time,
            link = EXCLUDED.link
        `;
      }
      for (const r of fresh) known.add(r.review_id);
      added += fresh.length;

      const extra: Record<string, unknown> = {};
      if (page === 0 && !token) {
        if (res.topics.length) extra.topics_json = JSON.stringify(res.topics);
        if (res.place) {
          extra.average_rating = res.place.rating;
          extra.total_reviews = res.place.reviews;
          extra.address = res.place.address;
          extra.place_type = res.place.type;
        }
      }
      token = res.nextToken;
      if (deepest) extra.next_token = token;
      await spend(location, extra);

      if (!token) {
        complete = true;
        break;
      }
      if (opts.mode === "refresh" && !fresh.length) {
        complete = !state?.next_token;
        break;
      }
    }

    if (place?.title && place.title !== project.placeTitle) {
      await db.prepare("UPDATE projects SET gbp_location_title = ? WHERE id = ?").run(place.title, project.id);
    }
    await db
      .prepare(
        `INSERT INTO gbp_state (project_id, location, synced_at, sync_error) VALUES (?, ?, ?, NULL)
         ON CONFLICT (project_id, location) DO UPDATE SET synced_at = EXCLUDED.synced_at, sync_error = NULL`,
      )
      .run(project.id, location, Date.now());
    return { fetched, added, creditsUsed, complete };
  } catch (e) {
    if (location) {
      await db
        .prepare(
          `INSERT INTO gbp_state (project_id, location, sync_error) VALUES (?, ?, ?)
           ON CONFLICT (project_id, location) DO UPDATE SET sync_error = EXCLUDED.sync_error`,
        )
        .run(project.id, location, (e instanceof Error ? e.message : String(e)).slice(0, 500));
    }
    throw e;
  }
}

async function pendingCount(projectId: number, location: string): Promise<number> {
  const r = (await db
    .prepare(
      `SELECT COUNT(*) AS n FROM gbp_reviews
        WHERE project_id = ? AND location = ? AND classified_at IS NULL AND comment <> ''`,
    )
    .get(projectId, location)) as { n: number };
  return Number(r.n);
}

const BATCH = 12;
const WORKERS = 4;

/**
 * Analyses reviews that haven't been classified yet, until none are left or
 * the time budget runs out (callers loop). Reviews without text keep their
 * star-based sentiment and never reach the model.
 */
export async function classifyPending(
  project: ReviewProject,
  budgetMs: number,
): Promise<{ classified: number; remaining: number; error?: string }> {
  const location = project.placeRef;
  if (!location) return { classified: 0, remaining: 0 };
  if (!classifierConfigured()) return { classified: 0, remaining: await pendingCount(project.id, location) };
  const started = Date.now();
  const business = project.placeTitle || project.name;

  // The aspect list is decided once per place from a sample of its reviews,
  // then stays fixed so tags mean the same thing over time.
  let aspects = parseList<string>((await stateFor(project.id, location))?.aspects_json).map(String);
  try {
    if (!aspects.length) {
      const sample = (await db
        .prepare(
          `SELECT COALESCE(source_en, comment) AS text FROM gbp_reviews
            WHERE project_id = ? AND location = ? AND comment <> ''
            ORDER BY create_time DESC LIMIT 150`,
        )
        .all(project.id, location)) as { text: string }[];
      if (!sample.length) return { classified: 0, remaining: 0 };
      aspects = await discoverAspects(
        business,
        sample.map((s) => s.text.slice(0, 300)),
      );
      await db
        .prepare(
          `INSERT INTO gbp_state (project_id, location, aspects_json) VALUES (?, ?, ?)
           ON CONFLICT (project_id, location) DO UPDATE SET aspects_json = EXCLUDED.aspects_json`,
        )
        .run(project.id, location, JSON.stringify(aspects));
    }
  } catch (e) {
    return {
      classified: 0,
      remaining: await pendingCount(project.id, location),
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const save = db.prepare(
    `UPDATE gbp_reviews SET sentiment = ?, comment_en = ?, points_json = ?, classified_at = ?
      WHERE project_id = ? AND location = ? AND review_id = ?`,
  );

  let classified = 0;
  let error: string | undefined;
  const taken = new Set<string>();

  async function worker() {
    while (!error && Date.now() - started < budgetMs) {
      const rows = (
        (await db
          .prepare(
            `SELECT review_id, star, comment, source_en FROM gbp_reviews
              WHERE project_id = ? AND location = ? AND classified_at IS NULL AND comment <> ''
              ORDER BY create_time DESC LIMIT ?`,
          )
          .all(project.id, location, BATCH * WORKERS * 2)) as {
          review_id: string;
          star: number;
          comment: string;
          source_en: string | null;
        }[]
      )
        .filter((r) => !taken.has(r.review_id))
        .slice(0, BATCH);
      if (!rows.length) return;
      for (const r of rows) taken.add(r.review_id);

      try {
        const out = await classifyBatch(
          business,
          aspects,
          rows.map((r) => ({ id: r.review_id, star: r.star, text: (r.source_en ?? r.comment).slice(0, 1500) })),
        );
        for (const r of rows) {
          const c = out.get(r.review_id);
          if (!c) continue; // left pending; retried on the next pass
          // Google's own translation wins over the model's when there is one.
          await save.run(
            c.sentiment,
            r.source_en ?? c.english,
            JSON.stringify(c.points),
            Date.now(),
            project.id,
            location,
            r.review_id,
          );
          classified++;
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker));

  return { classified, remaining: await pendingCount(project.id, location), error };
}

/** Everything the Reviews tab shows, read from storage. Costs no SerpApi credits. */
export async function reviewsData(project: ReviewProject, key: string): Promise<ReviewsData> {
  const location = await ensurePlaceRef(project);

  let creditsLeft: number | null = null;
  let keyError: string | null = null;
  try {
    creditsLeft = await searchesLeft(key);
  } catch (e) {
    keyError = e instanceof Error ? e.message : String(e);
  }

  const state = location ? await stateFor(project.id, location) : undefined;
  const rows = location
    ? ((await db
        .prepare(
          `SELECT review_id, reviewer_name, star, comment, source_en, comment_en, create_time,
                  reply_comment, reply_time, sentiment, points_json, classified_at, link
             FROM gbp_reviews WHERE project_id = ? AND location = ? ORDER BY create_time DESC`,
        )
        .all(project.id, location)) as {
        review_id: string;
        reviewer_name: string | null;
        star: number;
        comment: string | null;
        source_en: string | null;
        comment_en: string | null;
        create_time: number;
        reply_comment: string | null;
        reply_time: number | null;
        sentiment: string | null;
        points_json: string | null;
        classified_at: number | null;
        link: string | null;
      }[])
    : [];

  let pending = 0;
  const reviews: Review[] = rows.map((r) => {
    const analyzed = r.classified_at != null;
    if (!analyzed && r.comment) pending++;
    return {
      id: r.review_id,
      reviewer: r.reviewer_name ?? "",
      star: r.star,
      comment: r.comment ?? "",
      commentEn: r.source_en ?? r.comment_en,
      time: r.create_time,
      reply: r.reply_comment,
      replyTime: r.reply_time,
      link: r.link,
      sentiment: analyzed && r.sentiment ? (r.sentiment as Sentiment) : starSentiment(r.star),
      points: analyzed ? parseList<ReviewPoint>(r.points_json) : [],
      analyzed,
    };
  });

  const total = state?.total_reviews ?? null;
  return {
    placeTitle: project.placeTitle ?? "",
    address: state?.address ?? null,
    placeType: state?.place_type ?? null,
    averageRating: state?.average_rating ?? null,
    totalReviews: total,
    syncedAt: state?.synced_at ?? null,
    syncError: state?.sync_error ?? null,
    aspects: parseList<string>(state?.aspects_json).map(String),
    topics: parseList<{ keyword: string; mentions: number }>(state?.topics_json),
    reviews,
    pending,
    classifier: classifierConfigured(),
    creditsLeft,
    keyError,
    creditsSpent: state?.credits_spent ?? 0,
    // One extra credit when the link has no id and the place must be looked up first.
    lookupCredit: location ? 0 : 1,
    olderAvailable: Boolean(state?.next_token) && (total == null || reviews.length < total),
  };
}

export { creditsFor, savedCount };
