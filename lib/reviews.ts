import { db, rawSql } from "@/lib/db";
import { listReviews } from "@/lib/google/businessProfile";
import { classifierConfigured, classifyBatch, discoverAspects } from "@/lib/reviewClassify";
import {
  splitTranslated,
  starSentiment,
  type Review,
  type ReviewPoint,
  type ReviewsData,
  type Sentiment,
} from "@/lib/reviewTypes";

export interface ReviewProject {
  id: number;
  name: string;
  gbpLocation: string;
  gbpLocationTitle: string | null;
}

interface StateRow {
  average_rating: number | null;
  total_reviews: number | null;
  synced_at: number | null;
  sync_error: string | null;
  aspects_json: string | null;
}

async function stateFor(projectId: number, location: string): Promise<StateRow | undefined> {
  return (await db
    .prepare(
      `SELECT average_rating, total_reviews, synced_at, sync_error, aspects_json
         FROM gbp_state WHERE project_id = ? AND location = ?`,
    )
    .get(projectId, location)) as StateRow | undefined;
}

function parseAspects(json: string | null | undefined): string[] {
  try {
    const a = JSON.parse(json ?? "[]");
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Pulls the location's reviews from Google into gbp_reviews. The first run
 * takes everything; later runs stop once they reach reviews unchanged since a
 * few days before the previous sync. A review whose text or rating changed is
 * queued for re-analysis.
 */
export async function syncReviews(
  token: string,
  project: ReviewProject,
): Promise<{ fetched: number; total: number | null }> {
  const location = project.gbpLocation;
  const state = await stateFor(project.id, location);
  const now = Date.now();
  try {
    const { reviews, averageRating, totalReviewCount } = await listReviews(token, location, {
      stopBefore: state?.synced_at ? state.synced_at - 3 * 86400000 : undefined,
    });

    const rows = reviews.map((r) => ({
      project_id: project.id,
      location,
      review_id: r.reviewId,
      reviewer_name: r.reviewerName,
      star: r.star,
      comment: r.comment,
      create_time: r.createTime,
      update_time: r.updateTime,
      reply_comment: r.replyComment,
      reply_time: r.replyTime,
    }));
    const sql = await rawSql();
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      // No explicit VALUES keyword — see the note in lib/indexer.ts.
      await sql`
        INSERT INTO gbp_reviews ${sql(
          chunk,
          "project_id",
          "location",
          "review_id",
          "reviewer_name",
          "star",
          "comment",
          "create_time",
          "update_time",
          "reply_comment",
          "reply_time",
        )}
        ON CONFLICT (project_id, location, review_id) DO UPDATE SET
          reviewer_name = EXCLUDED.reviewer_name,
          classified_at = CASE
            WHEN gbp_reviews.comment IS DISTINCT FROM EXCLUDED.comment OR gbp_reviews.star <> EXCLUDED.star
            THEN NULL ELSE gbp_reviews.classified_at END,
          star = EXCLUDED.star, comment = EXCLUDED.comment, update_time = EXCLUDED.update_time,
          reply_comment = EXCLUDED.reply_comment, reply_time = EXCLUDED.reply_time
      `;
    }

    await db
      .prepare(
        `INSERT INTO gbp_state (project_id, location, average_rating, total_reviews, synced_at, sync_error)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT (project_id, location) DO UPDATE SET
           average_rating = EXCLUDED.average_rating, total_reviews = EXCLUDED.total_reviews,
           synced_at = EXCLUDED.synced_at, sync_error = NULL`,
      )
      .run(project.id, location, averageRating, totalReviewCount, now);
    return { fetched: reviews.length, total: totalReviewCount };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .prepare(
        `INSERT INTO gbp_state (project_id, location, sync_error) VALUES (?, ?, ?)
         ON CONFLICT (project_id, location) DO UPDATE SET sync_error = EXCLUDED.sync_error`,
      )
      .run(project.id, location, msg.slice(0, 500));
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
  const location = project.gbpLocation;
  if (!classifierConfigured()) return { classified: 0, remaining: await pendingCount(project.id, location) };
  const started = Date.now();
  const business = project.gbpLocationTitle || project.name;

  // The aspect list is decided once per location from a sample of its reviews,
  // then stays fixed so tags mean the same thing over time.
  let aspects = parseAspects((await stateFor(project.id, location))?.aspects_json);
  try {
    if (!aspects.length) {
      const sample = (await db
        .prepare(
          `SELECT comment FROM gbp_reviews WHERE project_id = ? AND location = ? AND comment <> ''
            ORDER BY create_time DESC LIMIT 150`,
        )
        .all(project.id, location)) as { comment: string }[];
      if (!sample.length) return { classified: 0, remaining: 0 };
      aspects = await discoverAspects(
        business,
        sample.map((s) => {
          const t = splitTranslated(s.comment);
          return (t.english ?? t.original).slice(0, 300);
        }),
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
            `SELECT review_id, star, comment FROM gbp_reviews
              WHERE project_id = ? AND location = ? AND classified_at IS NULL AND comment <> ''
              ORDER BY create_time DESC LIMIT ?`,
          )
          .all(project.id, location, BATCH * WORKERS * 2)) as {
          review_id: string;
          star: number;
          comment: string;
        }[]
      )
        .filter((r) => !taken.has(r.review_id))
        .slice(0, BATCH);
      if (!rows.length) return;
      for (const r of rows) taken.add(r.review_id);

      const split = new Map(rows.map((r) => [r.review_id, splitTranslated(r.comment)]));
      try {
        const out = await classifyBatch(
          business,
          aspects,
          rows.map((r) => {
            const t = split.get(r.review_id)!;
            return { id: r.review_id, star: r.star, text: (t.english ?? t.original).slice(0, 1500) };
          }),
        );
        for (const r of rows) {
          const c = out.get(r.review_id);
          if (!c) continue; // left pending; retried on the next pass
          await save.run(
            c.sentiment,
            split.get(r.review_id)!.english ?? c.english,
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

export async function reviewsData(project: ReviewProject): Promise<ReviewsData> {
  const location = project.gbpLocation;
  const state = await stateFor(project.id, location);
  const rows = (await db
    .prepare(
      `SELECT review_id, reviewer_name, star, comment, comment_en, create_time, reply_comment,
              reply_time, sentiment, points_json, classified_at
         FROM gbp_reviews WHERE project_id = ? AND location = ? ORDER BY create_time DESC`,
    )
    .all(project.id, location)) as {
    review_id: string;
    reviewer_name: string | null;
    star: number;
    comment: string | null;
    comment_en: string | null;
    create_time: number;
    reply_comment: string | null;
    reply_time: number | null;
    sentiment: string | null;
    points_json: string | null;
    classified_at: number | null;
  }[];

  let pending = 0;
  const reviews: Review[] = rows.map((r) => {
    const t = splitTranslated(r.comment ?? "");
    const analyzed = r.classified_at != null;
    if (!analyzed && t.original) pending++;
    let points: ReviewPoint[] = [];
    if (analyzed && r.points_json) {
      try {
        points = JSON.parse(r.points_json);
      } catch {
        /* keep none */
      }
    }
    return {
      id: r.review_id,
      reviewer: r.reviewer_name ?? "",
      star: r.star,
      comment: t.original,
      commentEn: r.comment_en ?? t.english,
      time: r.create_time,
      reply: r.reply_comment,
      replyTime: r.reply_time,
      sentiment: analyzed && r.sentiment ? (r.sentiment as Sentiment) : starSentiment(r.star),
      points,
      analyzed,
    };
  });

  return {
    location,
    locationTitle: project.gbpLocationTitle ?? "",
    averageRating: state?.average_rating ?? null,
    totalReviews: state?.total_reviews ?? null,
    syncedAt: state?.synced_at ?? null,
    syncError: state?.sync_error ?? null,
    aspects: parseAspects(state?.aspects_json),
    reviews,
    pending,
    classifier: classifierConfigured(),
  };
}
