// In-app notifications (migration 0010): created from persisted shared results (./rules.ts), Docs publications
// and a weekly digest; one inbox and read state per User. Nothing leaves the app: no email, Slack or Asana messages.
//
// Routing (docs/seo-console-v2/WORKSPACE-MEMBERS.md, section 7):
// - performance, rankings and completed-task progress: the project's management members (the primary manager is
//   one), unless they muted the project or the category. Viewing a project alone subscribes nobody.
// - upcoming / overdue task alerts: only the team member whose verified Asana user is the assignee, across every
//   visible project — never everyone's tasks to every editor.
// - spending failures: the payer and the project's managers (notifySpendingFailure).

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

export const MUTE_CATEGORIES = ["performance", "rankings", "tasks", "content"] as const;
export type MuteCategory = (typeof MUTE_CATEGORIES)[number];

/** The User's mutes: project 0 = every project. */
export async function listMutes(userId: number): Promise<Array<{ projectId: number; category: string }>> {
  if (!(await tableExists("notification_mutes"))) return [];
  const rows = (await db.prepare("SELECT project_id, category FROM notification_mutes WHERE user_id = ? ORDER BY project_id, category").all(userId)) as Array<{ project_id: number; category: string }>;
  return rows.map((r) => ({ projectId: Number(r.project_id), category: r.category }));
}

/** Mutes or unmutes a project (or every project: 0) for one category or "all". Personal; nobody else can change it. */
export async function setMute(userId: number, projectId: number, category: string, muted: boolean): Promise<void> {
  if (category !== "all" && !(MUTE_CATEGORIES as readonly string[]).includes(category)) throw new Error("Unknown notification category.");
  if (muted) {
    await db.prepare("INSERT INTO notification_mutes (user_id, project_id, category, muted_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING").run(userId, projectId, category, Date.now());
  } else {
    await db.prepare("DELETE FROM notification_mutes WHERE user_id = ? AND project_id = ? AND category = ?").run(userId, projectId, category);
  }
}

const ruleCategory = (rule: string): MuteCategory | null => ((MUTE_CATEGORIES as readonly string[]).includes(rule) ? (rule as MuteCategory) : null);

interface RoutedSection extends CachedSection {
  /** The User manages this project (subscribed to its project alerts by default). */
  manages: boolean;
}

/** Saved shared sections of the User's workspace, with whether the User manages each project. */
async function savedSections(userId: number): Promise<RoutedSection[]> {
  if (!(await tableExists("report_cache"))) return [];
  const ws = (await db.prepare("SELECT workspace_id FROM users WHERE id = ?").get(userId)) as { workspace_id: number | null } | undefined;
  if (!ws?.workspace_id) return [];
  const rows = (await db
    .prepare(
      `SELECT c.kind, c.project_id, p.name, c.query, c.payload, c.fetched_at,
              EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?) AS manages
         FROM report_cache c
         JOIN projects p ON p.id = c.project_id AND p.workspace_id = ? AND p.deleted_at IS NULL
        WHERE c.scope = ? AND c.kind IN ('summary:gsc', 'summary:ga4', 'summary:rankings', 'summary:tasks')
          AND c.payload IS NOT NULL AND c.access_error IS NULL AND c.fetched_at IS NOT NULL
        ORDER BY c.fetched_at DESC LIMIT 4000`,
    )
    .all(userId, ws.workspace_id, scopeOf(Number(ws.workspace_id)))) as Array<Record<string, unknown>>;
  const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
  return rows.map((r) => ({
    kind: String(r.kind),
    projectId: Number(r.project_id),
    projectName: String(r.name),
    query: parse(r.query) as CachedSection["query"],
    payload: parse(r.payload) as CachedSection["payload"],
    fetchedAt: Number(r.fetched_at),
    manages: Boolean(r.manages),
  }));
}

type TaskPayload = { overdueTasks?: Array<{ assigneeGid?: string | null }>; upcoming?: Array<{ assigneeGid?: string | null }>; recentlyCompleted?: unknown[] };

/**
 * The candidates this User should receive: project alerts of the projects they manage (not muted), and personal
 * task alerts for tasks assigned to their verified Asana user in any visible project.
 */
export async function candidatesForUser(userId: number, settings: NotificationSettings, now: number): Promise<Candidate[]> {
  const sections = await savedSections(userId);
  const mutes = await listMutes(userId);
  const muted = (projectId: number, category: string) =>
    mutes.some((m) => (m.projectId === 0 || m.projectId === projectId) && (m.category === "all" || m.category === category));
  const me = (await db.prepare("SELECT asana_user_gid FROM users WHERE id = ?").get(userId)) as { asana_user_gid: string | null } | undefined;
  const gid = me?.asana_user_gid ?? null;
  const forManager: CachedSection[] = [];
  const forAssignee: CachedSection[] = [];
  for (const s of sections) {
    const data = (s.payload as { data?: TaskPayload }).data;
    if (s.kind === "summary:tasks" && data) {
      // Managers: project progress (completed tasks) only.
      if (s.manages) forManager.push({ ...s, payload: { ...s.payload, data: { ...data, overdueTasks: [], upcoming: [] } } as CachedSection["payload"] });
      // The assignee: their own upcoming and overdue tasks, from any visible project.
      if (gid) {
        const mine = (list?: Array<{ assigneeGid?: string | null }>) => (list ?? []).filter((t) => t.assigneeGid === gid);
        forAssignee.push({ ...s, payload: { ...s.payload, data: { ...data, overdueTasks: mine(data.overdueTasks), upcoming: mine(data.upcoming), recentlyCompleted: [] } } as CachedSection["payload"] });
      }
    } else if (s.manages) {
      forManager.push(s);
    }
  }
  const out = [...candidatesFrom(forManager, settings, now), ...candidatesFrom(forAssignee, settings, now)];
  const seen = new Set<string>();
  return out.filter((c) => {
    if (seen.has(c.dedupeKey)) return false;
    seen.add(c.dedupeKey);
    const cat = ruleCategory(c.rule);
    return !(c.projectId != null && cat && muted(c.projectId, cat));
  });
}

/**
 * A paid job couldn't run (missing key, budget exhausted, payer inactive, access lost): the payer and the project's
 * managers are told, without secrets or anyone's spending details.
 */
export async function notifySpendingFailure(opts: { projectId: number; payerUserId: number | null; jobKey: string; reason: string; now?: number }): Promise<number> {
  if (!(await notificationsReady())) return 0;
  const now = opts.now ?? Date.now();
  const p = (await db.prepare("SELECT name FROM projects WHERE id = ?").get(opts.projectId)) as { name: string } | undefined;
  const managers = ((await db.prepare("SELECT user_id FROM project_members WHERE project_id = ?").all(opts.projectId)) as Array<{ user_id: number }>).map((r) => Number(r.user_id));
  const recipients = [...new Set([...(opts.payerUserId != null ? [opts.payerUserId] : []), ...managers])];
  let n = 0;
  for (const userId of recipients) {
    n += await insertCandidates(userId, [
      {
        rule: "spending",
        dedupeKey: `spending:${opts.projectId}:${opts.jobKey}`,
        projectId: opts.projectId,
        severity: "warning",
        title: `${p?.name ?? "A project"}: a paid run was paused`,
        body: opts.reason.slice(0, 300),
        href: `/p/${opts.projectId}/settings/project/sharing`,
        sourceAt: now,
      },
    ]);
  }
  return n;
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
  let created = await insertCandidates(userId, await candidatesForUser(userId, settings, now));
  if (settings.digest.enabled && new Date(now).getUTCDay() !== 0) {
    // The digest covers the 7 days before it's created; Monday–Saturday (UTC) create it if this week has none.
    const counts = (await db
      .prepare("SELECT rule, COUNT(*)::int AS n FROM notifications WHERE user_id = ? AND rule <> 'digest' AND created_at >= ? GROUP BY rule")
      .all(userId, now - 7 * 86_400_000)) as Array<{ rule: string; n: number }>;
    const projects = (await db
      .prepare("SELECT COUNT(*)::int AS n FROM project_members m JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL WHERE m.user_id = ?")
      .get(userId)) as { n: number };
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
