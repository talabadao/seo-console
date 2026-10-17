// Consolidating two existing User records of one person (a linked identity that already had its own record).
// Created by linkIdentity as a pending merge_request; the signed-in target User reviews a preview and makes an
// explicit choice for every conflict (different saved keys, different limits, different settings): never
// last-write-wins. Then one transaction moves the source's identities, project memberships, private data, usage and
// settings to the target, keeps one User id, marks the source 'merged' (merged_into = target) and audits it.
// Usage history keeps its origin (origin_user_id); consumed allowances are added to the target's counters (never
// reset, caps never added together). Credentials are decrypted with the source binding and re-encrypted for the
// target with the existing master key; no plaintext leaves the server.

import { db, withTransaction, type TxQuery } from "@/lib/db";
import { decryptFor, encryptFor } from "@/lib/credentials/crypto";

type Side = "target" | "source";

export interface MergeConflict {
  area: "credential" | "budget" | "notification-settings" | "scheduled-spending" | "asana";
  key: string;
  label: string;
}

export interface MergePreview {
  requestId: number;
  identityEmail: string;
  expiresAt: number;
  target: { id: number; email: string; name: string | null };
  source: { id: number; email: string; name: string | null; identities: string[] };
  moves: { projectsManaged: number; credentials: number; budgets: number; notifications: number; savedReports: number; usageRows: number; runs: number };
  conflicts: MergeConflict[];
}

interface RequestRow {
  id: number;
  target_user_id: number;
  source_user_id: number;
  identity_email: string;
  identity_issuer: string;
  identity_subject: string;
  status: string;
  expires_at: number;
}

async function request(requestId: number, targetUserId: number): Promise<RequestRow | null> {
  const r = (await db.prepare("SELECT * FROM merge_requests WHERE id = ? AND target_user_id = ?").get(requestId, targetUserId)) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    target_user_id: Number(r.target_user_id),
    source_user_id: Number(r.source_user_id),
    identity_email: String(r.identity_email),
    identity_issuer: String(r.identity_issuer),
    identity_subject: String(r.identity_subject),
    status: String(r.status),
    expires_at: Number(r.expires_at),
  };
}

const count = async (sql: string, ...args: unknown[]) => Number(((await db.prepare(sql).get(...args)) as { n: number }).n);

async function conflictsOf(target: number, source: number): Promise<MergeConflict[]> {
  const out: MergeConflict[] = [];
  const creds = (await db
    .prepare(
      `SELECT s.provider FROM account_credentials s JOIN account_credentials t ON t.provider = s.provider AND t.user_id = ?
        WHERE s.user_id = ? AND s.fingerprint <> t.fingerprint ORDER BY s.provider`,
    )
    .all(target, source)) as Array<{ provider: string }>;
  for (const c of creds) out.push({ area: "credential", key: c.provider, label: `Different saved ${c.provider} keys` });
  const budgets = (await db
    .prepare(
      `SELECT s.project_id, s.metric FROM budget_limits s JOIN budget_limits t ON t.user_id = ? AND t.project_id = s.project_id AND t.metric = s.metric
        WHERE s.user_id = ? AND s.limit_value IS DISTINCT FROM t.limit_value ORDER BY s.project_id, s.metric`,
    )
    .all(target, source)) as Array<{ project_id: number; metric: string }>;
  for (const b of budgets) out.push({ area: "budget", key: `${b.project_id}:${b.metric}`, label: `Different ${b.metric} limit${Number(b.project_id) ? ` for project ${b.project_id}` : " for the account"}` });
  const ns = (await db
    .prepare("SELECT s.settings::text AS s, t.settings::text AS t FROM notification_settings s JOIN notification_settings t ON t.user_id = ? WHERE s.user_id = ?")
    .get(target, source)) as { s: string; t: string } | undefined;
  if (ns && ns.s !== ns.t && ns.s !== "{}") out.push({ area: "notification-settings", key: "settings", label: "Different notification settings" });
  const spend = (await db
    .prepare(
      `SELECT s.provider FROM scheduled_spending s JOIN scheduled_spending t ON t.user_id = ? AND t.provider = s.provider
        WHERE s.user_id = ? AND s.enabled <> t.enabled ORDER BY s.provider`,
    )
    .all(target, source)) as Array<{ provider: string }>;
  for (const s of spend) out.push({ area: "scheduled-spending", key: s.provider, label: `Different scheduled spending setting for ${s.provider}` });
  const asana = (await db.prepare("SELECT s.asana_user_gid AS s, t.asana_user_gid AS t FROM users s, users t WHERE s.id = ? AND t.id = ?").get(source, target)) as
    | { s: string | null; t: string | null }
    | undefined;
  if (asana?.s && asana.t && asana.s !== asana.t) out.push({ area: "asana", key: "gid", label: "Different verified Asana users" });
  return out;
}

export async function mergePreview(requestId: number, targetUserId: number): Promise<MergePreview | null> {
  const r = await request(requestId, targetUserId);
  if (!r || r.status !== "pending" || r.expires_at < Date.now()) return null;
  const t = (await db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(r.target_user_id)) as { id: number; email: string; name: string | null };
  const s = (await db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(r.source_user_id)) as { id: number; email: string; name: string | null };
  const ids = (await db.prepare("SELECT email FROM user_identities WHERE user_id = ? ORDER BY id").all(r.source_user_id)) as Array<{ email: string }>;
  const src = r.source_user_id;
  return {
    requestId: r.id,
    identityEmail: r.identity_email,
    expiresAt: r.expires_at,
    target: { id: Number(t.id), email: t.email, name: t.name },
    source: { id: Number(s.id), email: s.email, name: s.name, identities: ids.map((i) => i.email) },
    moves: {
      projectsManaged: await count("SELECT COUNT(*)::int AS n FROM project_members WHERE user_id = ?", src),
      credentials: await count("SELECT COUNT(*)::int AS n FROM account_credentials WHERE user_id = ?", src),
      budgets: await count("SELECT COUNT(*)::int AS n FROM budget_limits WHERE user_id = ?", src),
      notifications: await count("SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ?", src),
      savedReports: await count("SELECT COUNT(*)::int AS n FROM ga4_saved_reports WHERE user_id = ?", src),
      usageRows: await count("SELECT COUNT(*)::int AS n FROM provider_usage WHERE user_id = ?", src),
      runs: await count("SELECT COUNT(*)::int AS n FROM ai_runs WHERE user_id = ?", src),
    },
    conflicts: await conflictsOf(r.target_user_id, r.source_user_id),
  };
}

export type MergeChoices = Record<string, Side>;
const choiceKey = (c: MergeConflict) => `${c.area}:${c.key}`;

/** Re-encrypts one stored credential from the source User's binding to the target's (same master key). */
async function moveCredential(q: TxQuery, source: number, target: number, provider: string, replace: boolean): Promise<void> {
  const [row] = await q("SELECT ciphertext, key_id, hint, fingerprint, updated_at, verified_at, verify_status, verify_message FROM account_credentials WHERE user_id = ? AND provider = ?", source, provider);
  if (!row) return;
  const plain = decryptFor(source, provider, String(row.ciphertext), String(row.key_id));
  const next = encryptFor(target, provider, plain);
  await q(
    `INSERT INTO account_credentials (user_id, provider, ciphertext, key_id, hint, fingerprint, updated_at, verified_at, verify_status, verify_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, provider) DO ${replace ? "UPDATE SET ciphertext = EXCLUDED.ciphertext, key_id = EXCLUDED.key_id, hint = EXCLUDED.hint, fingerprint = EXCLUDED.fingerprint, updated_at = EXCLUDED.updated_at, verified_at = EXCLUDED.verified_at, verify_status = EXCLUDED.verify_status, verify_message = EXCLUDED.verify_message" : "NOTHING"}`,
    target,
    provider,
    next.ciphertext,
    next.keyId,
    row.hint,
    row.fingerprint,
    row.updated_at,
    row.verified_at,
    row.verify_status,
    row.verify_message,
  );
}

/** Performs a previewed merge with an explicit choice for every conflict. */
export async function performMerge(requestId: number, targetUserId: number, choices: MergeChoices): Promise<{ ok: true } | { ok: false; message: string; missing?: string[] }> {
  const preview = await mergePreview(requestId, targetUserId);
  if (!preview) return { ok: false, message: "This merge request has expired or was already handled. Link the login again." };
  const missing = preview.conflicts.filter((c) => choices[choiceKey(c)] !== "target" && choices[choiceKey(c)] !== "source").map(choiceKey);
  if (missing.length) return { ok: false, message: "Choose which value to keep for every difference.", missing };
  const target = preview.target.id;
  const source = preview.source.id;
  const pick = (area: MergeConflict["area"], key: string): Side | null => choices[`${area}:${key}`] ?? null;
  const now = Date.now();

  await withTransaction(async (q) => {
    const [claim] = await q("UPDATE merge_requests SET status = 'running' WHERE id = ? AND status = 'pending' RETURNING id", requestId);
    if (!claim) throw new Error("This merge request was already handled.");

    // Logins.
    await q("UPDATE user_identities SET user_id = ? WHERE user_id = ?", target, source);
    // Project management: memberships and primary management move; creator attribution stays (history).
    await q(`INSERT INTO project_members (project_id, user_id, added_by, added_at) SELECT project_id, ?, added_by, added_at FROM project_members WHERE user_id = ? ON CONFLICT DO NOTHING`, target, source);
    await q("DELETE FROM project_members WHERE user_id = ?", source);
    await q("UPDATE projects SET primary_manager_id = ? WHERE primary_manager_id = ?", target, source);
    // Credentials: identical keys collapse; different keys follow the explicit choice.
    for (const row of await q("SELECT provider, fingerprint FROM account_credentials WHERE user_id = ?", source)) {
      const provider = String(row.provider);
      const [mine] = await q("SELECT fingerprint FROM account_credentials WHERE user_id = ? AND provider = ?", target, provider);
      if (!mine) await moveCredential(q, source, target, provider, false);
      else if (mine.fingerprint !== row.fingerprint && pick("credential", provider) === "source") await moveCredential(q, source, target, provider, true);
    }
    await q("DELETE FROM account_credentials WHERE user_id = ?", source);
    // Limits.
    for (const b of await q("SELECT project_id, metric, limit_value, updated_at FROM budget_limits WHERE user_id = ?", source)) {
      const choice = pick("budget", `${b.project_id}:${b.metric}`);
      await q(
        `INSERT INTO budget_limits (user_id, project_id, metric, limit_value, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, project_id, metric) DO ${choice === "source" ? "UPDATE SET limit_value = EXCLUDED.limit_value, updated_at = EXCLUDED.updated_at" : "NOTHING"}`,
        target,
        b.project_id,
        b.metric,
        b.limit_value,
        b.updated_at,
      );
    }
    await q("DELETE FROM budget_limits WHERE user_id = ?", source);
    // Consumed allowances are added to the target's counters (never reset); caps come from the target's limits.
    for (const a of await q("SELECT key, max_units, used_units, note FROM provider_allowances WHERE key LIKE ? OR key LIKE ? OR key LIKE ?", `serpapi-month:user:${source}:%`, `llm-usd:user:${source}:%`, `llm-usd-month:user:${source}:%`)) {
      const key = String(a.key).replace(`:user:${source}:`, `:user:${target}:`);
      await q(
        `INSERT INTO provider_allowances (key, max_units, used_units, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET used_units = provider_allowances.used_units + EXCLUDED.used_units, updated_at = EXCLUDED.updated_at`,
        key,
        a.max_units,
        a.used_units,
        a.note,
        now,
        now,
      );
      await q("UPDATE provider_allowances SET used_units = 0, note = ?, updated_at = ? WHERE key = ?", `merged into user ${target}`, now, a.key);
    }
    // Usage, runs and private records keep their origin and now belong to the target.
    await q("UPDATE provider_usage SET user_id = ?, origin_user_id = COALESCE(origin_user_id, ?) WHERE user_id = ?", target, source, source);
    await q("UPDATE ai_runs SET user_id = ?, payer_user_id = CASE WHEN payer_user_id = ? THEN ? ELSE payer_user_id END, origin_user_id = COALESCE(origin_user_id, ?) WHERE user_id = ?", target, source, target, source, source);
    await q("UPDATE serp_configs SET user_id = ? WHERE user_id = ?", target, source);
    await q("UPDATE serp_snapshots SET user_id = ?, origin_user_id = COALESCE(origin_user_id, ?) WHERE user_id = ?", target, source, source);
    await q("UPDATE ga4_saved_reports SET user_id = ? WHERE user_id = ?", target, source);
    // Weekly Report selections: the target keeps its own for the same property and month.
    await q(
      `UPDATE weekly_kpi_config w SET user_id = ? WHERE w.user_id = ?
          AND NOT EXISTS (SELECT 1 FROM weekly_kpi_config t WHERE t.user_id = ? AND t.property_id = w.property_id AND t.year_month = w.year_month)`,
      target,
      source,
      target,
    );
    // Conflicting rows stay on the merged record (history), not deleted.
    // One inbox: the target keeps its read state for duplicates; opt-outs from both profiles are kept.
    await q(
      `INSERT INTO notifications (user_id, project_id, rule, dedupe_key, severity, title, body, href, source_at, created_at, read_at)
       SELECT ?, project_id, rule, dedupe_key, severity, title, body, href, source_at, created_at, read_at FROM notifications WHERE user_id = ?
       ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
      target,
      source,
    );
    await q("DELETE FROM notifications WHERE user_id = ?", source);
    await q("INSERT INTO notification_mutes (user_id, project_id, category, muted_at) SELECT ?, project_id, category, muted_at FROM notification_mutes WHERE user_id = ? ON CONFLICT DO NOTHING", target, source);
    await q("DELETE FROM notification_mutes WHERE user_id = ?", source);
    const nsChoice = pick("notification-settings", "settings");
    await q(
      `INSERT INTO notification_settings (user_id, settings, updated_at) SELECT ?, settings, updated_at FROM notification_settings WHERE user_id = ?
       ON CONFLICT (user_id) DO ${nsChoice === "source" ? "UPDATE SET settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at" : "NOTHING"}`,
      target,
      source,
    );
    await q("DELETE FROM notification_settings WHERE user_id = ?", source);
    for (const s of await q("SELECT provider, enabled FROM scheduled_spending WHERE user_id = ?", source)) {
      const choice = pick("scheduled-spending", String(s.provider));
      await q(
        `INSERT INTO scheduled_spending (user_id, provider, enabled, version, updated_at) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT (user_id, provider) DO ${choice === "source" ? "UPDATE SET enabled = EXCLUDED.enabled, version = scheduled_spending.version + 1, updated_at = EXCLUDED.updated_at" : "NOTHING"}`,
        target,
        s.provider,
        s.enabled,
        now,
      );
    }
    await q("DELETE FROM scheduled_spending WHERE user_id = ?", source);
    // The source stops being an active person first, so its Asana user can move without two active owners.
    await q("UPDATE users SET status = 'merged', merged_into = ?, updated_at = ? WHERE id = ?", target, now, source);
    // Profile details the target doesn't have yet; the Asana user follows the explicit choice when both differ.
    const asanaChoice = pick("asana", "gid");
    await q(
      `UPDATE users t SET job_title = COALESCE(t.job_title, s.job_title),
              asana_user_gid = CASE WHEN ? = 'source' OR t.asana_user_gid IS NULL THEN s.asana_user_gid ELSE t.asana_user_gid END,
              asana_user_name = CASE WHEN ? = 'source' OR t.asana_user_gid IS NULL THEN s.asana_user_name ELSE t.asana_user_name END,
              asana_verified_at = CASE WHEN ? = 'source' OR t.asana_user_gid IS NULL THEN s.asana_verified_at ELSE t.asana_verified_at END,
              asana_verified_via = CASE WHEN ? = 'source' OR t.asana_user_gid IS NULL THEN s.asana_verified_via ELSE t.asana_verified_via END,
              updated_at = ?
         FROM users s WHERE t.id = ? AND s.id = ?`,
      asanaChoice ?? "target",
      asanaChoice ?? "target",
      asanaChoice ?? "target",
      asanaChoice ?? "target",
      now,
      target,
      source,
    );
    await q("UPDATE google_connections SET granted_by_user_id = ? WHERE granted_by_user_id = ?", target, source);
    await q("UPDATE asana_connections SET granted_by_user_id = ? WHERE granted_by_user_id = ?", target, source);
    await q("UPDATE merge_requests SET status = 'done', choices = ?::jsonb, resolved_at = ? WHERE id = ?", JSON.stringify(choices), now, requestId);
    await q(
      "INSERT INTO identity_audit (user_id, event, email, detail, created_at) VALUES (?, 'merge', ?, ?::jsonb, ?)",
      target,
      preview.identityEmail,
      JSON.stringify({ sourceUserId: source, choices, moves: preview.moves }),
      now,
    );
  });
  return { ok: true };
}

/** Declines a pending merge: nothing changes. */
export async function cancelMerge(requestId: number, targetUserId: number): Promise<boolean> {
  const r = await db.prepare("UPDATE merge_requests SET status = 'cancelled', resolved_at = ? WHERE id = ? AND target_user_id = ? AND status = 'pending'").run(Date.now(), requestId, targetUserId);
  return r.count > 0;
}
