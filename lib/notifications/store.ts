// In-app notifications (migration 0010): created from persisted sync results (./rules.ts), Docs publications and
// a weekly digest; listed, filtered and marked read/unread by the account that owns them. Nothing leaves the app:
// no email, Slack or Asana messages.

import { db, tableExists } from "@/lib/db";
import { scopeOf } from "@/lib/sync/cache";
import { candidatesFrom, digestCandidate, normalizeSettings, type Candidate, type CachedSection, type NotificationSettings } from "./rules";

/** Rules run at most this often per account (on reads of the bell, sync runs and the scheduled tick). */
export const RUN_EVERY_MS = 10 * 60_000;

export interface NotificationRow {
  id: number;
  projectId: number | null;
  projectName: string | null;
  severity: "info" | "warning" | "critical";
  kind: string;
  title: string;
  body: string;
  sourceAt: number;
  createdAt: number;
  readAt: number | null;
  href: string | null;
}

export const notificationsReady = () => tableExists("notifications");

export async function getSettings(userId: number): Promise<NotificationSettings> {
  const r = (await db.prepare("SELECT settings FROM notification_settings WHERE user_id = ?").get(userId)) as { settings: unknown } | undefined;
  return normalizeSettings(typeof r?.settings === "string" ? JSON.parse(r.settings) : r?.settings);
}

export async function saveSettings(userId: number, raw: unknown): Promise<NotificationSettings> {
  const settings = normalizeSettings(raw);
  await db
    .prepare(
      `INSERT INTO notification_settings (user_id, settings, updated_at) VALUES (?, ?::jsonb, ?)
       ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at`,
    )
    .run(userId, JSON.stringify(settings), Date.now());
  return settings;
}

/** Inserts candidates once each (unique per account + dedupe key). Returns how many were new. */
export async function insertCandidates(userId: number, candidates: Candidate[]): Promise<number> {
  let n = 0;
  const now = Date.now();
  for (const c of candidates) {
    const r = await db
      .prepare(
        `INSERT INTO notifications (user_id, project_id, rule, dedupe_key, severity, title, body, href, source_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
      )
      .run(userId, c.projectId, c.rule, c.dedupeKey, c.severity, c.title.slice(0, 300), c.body.slice(0, 2000), c.href, c.sourceAt, now);
    n += r.count;
  }
  return n;
}

/** Saved sections this account's projects have in the shared cache (the account's own scope only). */
async function savedSections(userId: number): Promise<CachedSection[]> {
  if (!(await tableExists("report_cache"))) return [];
  const rows = (await db
    .prepare(
      `SELECT c.kind, c.project_id, p.name, c.query, c.payload, c.fetched_at FROM report_cache c
         JOIN projects p ON p.id = c.project_id AND p.user_id = ?
        WHERE c.scope = ? AND c.kind IN ('summary:gsc', 'summary:ga4', 'summary:rankings', 'summary:tasks')
          AND c.payload IS NOT NULL AND c.access_error IS NULL AND c.fetched_at IS NOT NULL
        ORDER BY c.fetched_at DESC LIMIT 2000`,
    )
    .all(userId, scopeOf(userId))) as Array<Record<string, unknown>>;
  const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
  return rows.map((r) => ({
    kind: String(r.kind),
    projectId: Number(r.project_id),
    projectName: String(r.name),
    query: parse(r.query) as CachedSection["query"],
    payload: parse(r.payload) as CachedSection["payload"],
    fetchedAt: Number(r.fetched_at),
  }));
}

/**
 * Runs the rules for one account if they haven't run in the last RUN_EVERY_MS (or `force`): notifications from
 * saved sections, then the weekly digest from Monday on. Claims the run atomically so concurrent callers on
 * several instances don't duplicate work (inserts are deduplicated anyway).
 */
export async function runRules(userId: number, opts: { force?: boolean; now?: number } = {}): Promise<{ ran: boolean; created: number }> {
  if (!(await notificationsReady())) return { ran: false, created: 0 };
  const now = opts.now ?? Date.now();
  await db
    .prepare("INSERT INTO notification_settings (user_id, settings, updated_at) VALUES (?, '{}'::jsonb, ?) ON CONFLICT (user_id) DO NOTHING")
    .run(userId, now);
  const claimed = await db
    .prepare("UPDATE notification_settings SET last_run_at = ? WHERE user_id = ? AND (? OR last_run_at IS NULL OR last_run_at < ?)")
    .run(now, userId, Boolean(opts.force), now - RUN_EVERY_MS);
  if (!claimed.count) return { ran: false, created: 0 };
  const settings = await getSettings(userId);
  let created = await insertCandidates(userId, candidatesFrom(await savedSections(userId), settings, now));
  if (settings.digest.enabled && new Date(now).getUTCDay() !== 0) {
    // The digest covers the 7 days before it's created; Monday–Saturday (UTC) create it if this week has none.
    const counts = (await db
      .prepare("SELECT rule, COUNT(*)::int AS n FROM notifications WHERE user_id = ? AND rule <> 'digest' AND created_at >= ? GROUP BY rule")
      .all(userId, now - 7 * 86_400_000)) as Array<{ rule: string; n: number }>;
    const projects = (await db.prepare("SELECT COUNT(*)::int AS n FROM projects WHERE user_id = ?").get(userId)) as { n: number };
    created += await insertCandidates(userId, [digestCandidate(Object.fromEntries(counts.map((c) => [c.rule, Number(c.n)])), Number(projects.n), now)]);
  }
  return { ran: true, created };
}

/** The account's notifications, newest first, optionally for one project (account-wide ones are always included). */
export async function listNotifications(userId: number, opts: { projectId?: number | null; limit?: number; unreadOnly?: boolean } = {}): Promise<{ unread: number; items: NotificationRow[] }> {
  const project = opts.projectId ?? null;
  const where = `n.user_id = ? AND (?::bigint IS NULL OR n.project_id = ? OR n.project_id IS NULL)`;
  const rows = (await db
    .prepare(
      `SELECT n.id, n.project_id, p.name AS project_name, n.severity, n.rule, n.title, n.body, n.source_at, n.created_at, n.read_at, n.href
         FROM notifications n LEFT JOIN projects p ON p.id = n.project_id
        WHERE ${where} ${opts.unreadOnly ? "AND n.read_at IS NULL" : ""}
        ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
    )
    .all(userId, project, project, Math.min(200, opts.limit ?? 40))) as Array<Record<string, unknown>>;
  const unread = (await db.prepare(`SELECT COUNT(*)::int AS n FROM notifications n WHERE ${where} AND n.read_at IS NULL`).get(userId, project, project)) as { n: number };
  return {
    unread: Number(unread.n),
    items: rows.map((r) => ({
      id: Number(r.id),
      projectId: r.project_id == null ? null : Number(r.project_id),
      projectName: (r.project_name as string | null) ?? null,
      severity: r.severity as NotificationRow["severity"],
      kind: String(r.rule),
      title: String(r.title),
      body: String(r.body),
      sourceAt: Number(r.source_at),
      createdAt: Number(r.created_at),
      readAt: r.read_at == null ? null : Number(r.read_at),
      href: (r.href as string | null) ?? null,
    })),
  };
}

/** Marks the given notifications (or all, optionally for one project) read or unread. Only the account's own. */
export async function markRead(userId: number, opts: { ids?: number[]; all?: boolean; projectId?: number | null; unread?: boolean }): Promise<number> {
  const value = opts.unread ? null : Date.now();
  if (opts.all) {
    const project = opts.projectId ?? null;
    const r = await db
      .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND (?::bigint IS NULL OR project_id = ? OR project_id IS NULL) AND (read_at IS NULL) = ?`)
      .run(value, userId, project, project, !opts.unread);
    return r.count;
  }
  let n = 0;
  for (const id of (opts.ids ?? []).slice(0, 200)) {
    const r = await db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?").run(value, id, userId);
    n += r.count;
  }
  return n;
}
