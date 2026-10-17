// Docs: a minimal list of articles and news with a publication state (migration 0010 doc_articles).
//
// - Everyone signed in reads published articles. Only explicit Docs admins — addresses in DOCS_ADMIN_EMAILS that
//   are also on the sign-in allowlist — see drafts and create, edit, publish or unpublish. Being allowed to sign in
//   is not enough. With DOCS_ADMIN_EMAILS unset nobody can publish.
// - Publishing a real (non-demo) article notifies each account once (dedupe "docs:<id>"), in-app only.
// - Preview and local development get two example articles marked demo: labelled, and never notified.

import { db, tableExists } from "@/lib/db";
import { deploymentOf } from "@/lib/environment";
import { isAllowedEmail, normalizeEmail } from "@/lib/auth/allowlist";
import { getSettings, insertCandidates } from "@/lib/notifications/store";

type Env = Record<string, string | undefined>;

export interface DocArticle {
  id: number;
  slug: string;
  kind: "article" | "news";
  title: string;
  summary: string;
  body: string;
  status: "draft" | "published";
  demo: boolean;
  publishedAt: number | null;
  updatedAt: number;
}

export class DocsInputError extends Error {}
export class DocsForbidden extends Error {}

export const docsReady = () => tableExists("doc_articles");

/** Docs admins: listed in DOCS_ADMIN_EMAILS and allowed to sign in. */
export function isDocsAdmin(email: string | null | undefined, env: Env = process.env): boolean {
  if (!email || !isAllowedEmail(email)) return false;
  const admins = (env.DOCS_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => normalizeEmail(s))
    .filter(Boolean);
  return admins.includes(normalizeEmail(email));
}

function row(r: Record<string, unknown>): DocArticle {
  return {
    id: Number(r.id),
    slug: String(r.slug),
    kind: r.kind as DocArticle["kind"],
    title: String(r.title),
    summary: String(r.summary ?? ""),
    body: String(r.body ?? ""),
    status: r.status as DocArticle["status"],
    demo: Boolean(r.demo),
    publishedAt: r.published_at == null ? null : Number(r.published_at),
    updatedAt: Number(r.updated_at),
  };
}

const COLS = "id, slug, kind, title, summary, body, status, demo, published_at, updated_at";

const DEMO: Array<Pick<DocArticle, "slug" | "kind" | "title" | "summary" | "body">> = [
  {
    slug: "demo-getting-started",
    kind: "article",
    title: "Getting started with SEO Console (demo)",
    summary: "Example article: how projects, connections and dashboards fit together.",
    body: "## Projects\nA project groups one website with its Search Console property, GA4 property, SE Ranking project and Asana project.\n\n## Saved data\nDashboards read saved results first and refresh in the background.\n\n- Example article for Preview only.\n- It is not product documentation.",
  },
  {
    slug: "demo-whats-new",
    kind: "news",
    title: "What's new: Rank tracking (demo)",
    summary: "Example news item: SE Ranking and Organic SERP pages.",
    body: "Rank tracking now has an SE Ranking report and an Organic SERP page.\n\nThis is an example news item shown on Preview only.",
  },
];

/** Adds the demo examples on Preview and in development (never on Production). */
export async function ensureDemoDocs(env: Env = process.env): Promise<void> {
  if (deploymentOf(env) === "production") return;
  const now = Date.now();
  for (const d of DEMO) {
    await db
      .prepare(
        `INSERT INTO doc_articles (slug, kind, title, summary, body, status, demo, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'published', TRUE, ?, ?, ?) ON CONFLICT (slug) DO NOTHING`,
      )
      .run(d.slug, d.kind, d.title, d.summary, d.body, now, now, now);
  }
}

export async function listArticles(opts: { admin: boolean }): Promise<DocArticle[]> {
  const rows = (await db
    .prepare(`SELECT ${COLS} FROM doc_articles ${opts.admin ? "" : "WHERE status = 'published'"} ORDER BY COALESCE(published_at, updated_at) DESC, id DESC LIMIT 200`)
    .all()) as Record<string, unknown>[];
  return rows.map(row);
}

export async function getArticle(slug: string, opts: { admin: boolean }): Promise<DocArticle | null> {
  const r = (await db.prepare(`SELECT ${COLS} FROM doc_articles WHERE slug = ? ${opts.admin ? "" : "AND status = 'published'"}`).get(slug)) as
    | Record<string, unknown>
    | undefined;
  return r ? row(r) : null;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Creates or updates an article as a draft or keeps its state. Admins only (checked by the caller and here). */
export async function saveArticle(
  admin: { id: number; email: string },
  input: { id?: number | null; slug?: unknown; kind?: unknown; title?: unknown; summary?: unknown; body?: unknown },
  env: Env = process.env,
): Promise<DocArticle> {
  if (!isDocsAdmin(admin.email, env)) throw new DocsForbidden("Only Docs admins can edit articles.");
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 200) : "";
  if (!title) throw new DocsInputError("Enter a title.");
  const slug = typeof input.slug === "string" && input.slug.trim() ? input.slug.trim().toLowerCase() : title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!SLUG.test(slug) || slug.length > 100) throw new DocsInputError("The address may only use lowercase letters, digits and dashes.");
  if (slug.startsWith("demo-")) throw new DocsInputError("Addresses starting with demo- are reserved for examples.");
  const kind = input.kind === "news" ? "news" : "article";
  const summary = typeof input.summary === "string" ? input.summary.trim().slice(0, 500) : "";
  const body = typeof input.body === "string" ? input.body.slice(0, 50_000) : "";
  const now = Date.now();
  try {
    if (input.id) {
      const r = (await db
        .prepare(`UPDATE doc_articles SET slug = ?, kind = ?, title = ?, summary = ?, body = ?, updated_at = ? WHERE id = ? AND demo = FALSE RETURNING ${COLS}`)
        .get(slug, kind, title, summary, body, now, input.id)) as Record<string, unknown> | undefined;
      if (!r) throw new DocsInputError("That article no longer exists (demo examples can't be edited).");
      return row(r);
    }
    const r = (await db
      .prepare(`INSERT INTO doc_articles (slug, kind, title, summary, body, status, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?) RETURNING ${COLS}`)
      .get(slug, kind, title, summary, body, admin.id, now, now)) as Record<string, unknown>;
    return row(r);
  } catch (e) {
    if (e instanceof Error && /unique|duplicate/i.test(e.message)) throw new DocsInputError("Another article already uses that address.");
    throw e;
  }
}

/** Publishes or unpublishes. Publishing a real article notifies every account once (in-app). */
export async function setPublished(admin: { id: number; email: string }, id: number, publish: boolean, env: Env = process.env): Promise<DocArticle> {
  if (!isDocsAdmin(admin.email, env)) throw new DocsForbidden("Only Docs admins can publish.");
  const now = Date.now();
  const r = (await db
    .prepare(
      `UPDATE doc_articles SET status = ?, published_at = CASE WHEN ? THEN COALESCE(published_at, ?) ELSE published_at END, updated_at = ?
        WHERE id = ? AND demo = FALSE RETURNING ${COLS}`,
    )
    .get(publish ? "published" : "draft", publish, now, now, id)) as Record<string, unknown> | undefined;
  if (!r) throw new DocsInputError("That article no longer exists (demo examples can't be changed).");
  const article = row(r);
  if (publish && !article.demo && (await tableExists("notifications"))) {
    const users = (await db.prepare("SELECT id, email FROM users").all()) as Array<{ id: number; email: string }>;
    for (const u of users) {
      if (!isAllowedEmail(u.email) || !(await getSettings(Number(u.id))).docs.enabled) continue;
      await insertCandidates(Number(u.id), [
        {
          rule: "docs",
          dedupeKey: `docs:${article.id}`,
          projectId: null,
          severity: "info",
          title: `New in Docs: ${article.title}`,
          body: article.summary || (article.kind === "news" ? "A new news item was published." : "A new article was published."),
          href: `/docs/${article.slug}`,
          sourceAt: article.publishedAt ?? now,
        },
      ]);
    }
  }
  return article;
}
