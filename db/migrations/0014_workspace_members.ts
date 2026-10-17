import type { Migration } from "../../lib/migrations";

/**
 * Personal Users, one shared workspace, shared Google data connections (docs/seo-console-v2/WORKSPACE-MEMBERS.md).
 * Additive and idempotent: new tables and nullable/defaulted columns, backfills guarded so a rerun changes nothing,
 * no row deleted. Existing ids are kept (users stay the canonical people, so encrypted credentials keep their
 * binding), and projects.user_id stays the legacy owner so the previous release still reads the data the same way.
 *
 * - workspaces / brands: one team ("SEO Console") with two company labels.
 * - users: kind (person | shared-connection), status (active | disabled | merged), merged_into, job title and the
 *   verified Asana user. The two analytics@ accounts become shared-connection holders: never personal logins.
 * - user_identities: verified Google identities by (issuer, subject); several per person (linked logins).
 * - identity_audit: logins, links, unlinks, merges and operator status changes.
 * - merge_requests: a pending link that would consolidate two existing records (preview + explicit choices).
 * - projects: workspace, brand, immutable creator, primary manager, soft delete, the Google/Asana connection each
 *   mapping uses, and a spending-authorization version.
 * - project_members: project management members (the primary manager is always one).
 * - google_connections / asana_connections: workspace data sources; refresh tokens and Asana tokens are stored
 *   encrypted by the application (filled from the legacy plaintext columns on first use, which stay untouched).
 * - sites / ga_properties: discovered per connection (connection_id); user_id becomes optional.
 * - notification_mutes, scheduled_spending: personal settings.
 * - ai_runs / provider_usage: payer, credential reference and authorization version; origin user for history.
 * - project_settings.ai_domains: AI source domains per project (was a per-login setting).
 */
const NOW = "(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint";
const COMPANY = "split_part(lower(u.email), '@', 2) IN ('artemisdigital.com', 'headsonpillows.com')";
const GMAIL_EXCEPTION = "lower(u.email) = 'tinledoihoa@gmail.com'";
const ANALYTICS = "lower(u.email) IN ('analytics@artemisdigital.com', 'analytics@headsonpillows.com')";

export const migration: Migration = {
  id: "0014_workspace_members",
  description: "Personal Users, shared workspace projects, verified identities and shared Google connections",
  statements: [
    // --- Workspace and brands -------------------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS workspaces (
       id          BIGSERIAL PRIMARY KEY,
       name        TEXT NOT NULL,
       created_at  BIGINT NOT NULL
     )`,
    `INSERT INTO workspaces (id, name, created_at) VALUES (1, 'SEO Console', ${NOW}) ON CONFLICT (id) DO NOTHING`,
    `SELECT setval(pg_get_serial_sequence('workspaces', 'id'), GREATEST((SELECT MAX(id) FROM workspaces), 1))`,
    `CREATE TABLE IF NOT EXISTS brands (
       id            BIGSERIAL PRIMARY KEY,
       workspace_id  BIGINT NOT NULL REFERENCES workspaces(id),
       name          TEXT NOT NULL,
       email_domain  TEXT,
       UNIQUE (workspace_id, name)
     )`,
    `INSERT INTO brands (workspace_id, name, email_domain) VALUES (1, 'Artemis Digital', 'artemisdigital.com'), (1, 'Heads on Pillows', 'headsonpillows.com')
       ON CONFLICT (workspace_id, name) DO NOTHING`,

    // --- People -----------------------------------------------------------------------------------------------
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS workspace_id BIGINT REFERENCES workspaces(id)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'person'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS merged_into BIGINT REFERENCES users(id)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS asana_user_gid TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS asana_user_name TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS asana_verified_at BIGINT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS asana_verified_via TEXT`,
    `UPDATE users u SET kind = 'shared-connection' WHERE ${ANALYTICS} AND u.kind <> 'shared-connection'`,
    `UPDATE users u SET workspace_id = 1 WHERE u.workspace_id IS NULL AND (${COMPANY} OR ${GMAIL_EXCEPTION})`,
    `CREATE TABLE IF NOT EXISTS user_identities (
       id             BIGSERIAL PRIMARY KEY,
       user_id        BIGINT NOT NULL REFERENCES users(id),
       issuer         TEXT NOT NULL,
       subject        TEXT NOT NULL,
       email          TEXT NOT NULL,
       hosted_domain  TEXT,
       created_at     BIGINT NOT NULL,
       last_login_at  BIGINT,
       UNIQUE (issuer, subject)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_user_identities_email ON user_identities(lower(email))`,
    `CREATE TABLE IF NOT EXISTS identity_audit (
       id           BIGSERIAL PRIMARY KEY,
       user_id      BIGINT,
       identity_id  BIGINT,
       event        TEXT NOT NULL,
       email        TEXT,
       detail       JSONB,
       created_at   BIGINT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_identity_audit_user ON identity_audit(user_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS merge_requests (
       id                BIGSERIAL PRIMARY KEY,
       target_user_id    BIGINT NOT NULL REFERENCES users(id),
       source_user_id    BIGINT NOT NULL REFERENCES users(id),
       identity_issuer   TEXT NOT NULL,
       identity_subject  TEXT NOT NULL,
       identity_email    TEXT NOT NULL,
       hosted_domain     TEXT,
       status            TEXT NOT NULL DEFAULT 'pending',
       choices           JSONB,
       created_at        BIGINT NOT NULL,
       expires_at        BIGINT NOT NULL,
       resolved_at       BIGINT
     )`,

    // --- Shared Google and Asana data connections -------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS google_connections (
       id                  BIGSERIAL PRIMARY KEY,
       workspace_id        BIGINT NOT NULL REFERENCES workspaces(id),
       issuer              TEXT,
       subject             TEXT,
       email               TEXT NOT NULL,
       ciphertext          TEXT,
       key_id              TEXT,
       access_token        TEXT,
       access_expiry       BIGINT,
       scopes              TEXT,
       status              TEXT NOT NULL DEFAULT 'ok',
       last_error          TEXT,
       granted_by_user_id  BIGINT REFERENCES users(id),
       legacy_user_id      BIGINT REFERENCES users(id),
       created_at          BIGINT NOT NULL,
       updated_at          BIGINT NOT NULL
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_google_connections_identity ON google_connections(issuer, subject) WHERE subject IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_google_connections_legacy ON google_connections(legacy_user_id) WHERE legacy_user_id IS NOT NULL`,
    // One connection per legacy account that holds a Google grant or discovered data.
    `INSERT INTO google_connections (workspace_id, email, scopes, status, granted_by_user_id, legacy_user_id, created_at, updated_at)
     SELECT 1, u.email, u.google_scopes, CASE WHEN u.google_refresh_token IS NULL THEN 'needs-reconnect' ELSE 'ok' END,
            CASE WHEN u.kind = 'person' THEN u.id END, u.id, ${NOW}, ${NOW}
       FROM users u
      WHERE (u.workspace_id = 1 OR ${ANALYTICS})
        AND (u.google_refresh_token IS NOT NULL OR EXISTS (SELECT 1 FROM sites s WHERE s.user_id = u.id) OR EXISTS (SELECT 1 FROM ga_properties g WHERE g.user_id = u.id))
     ON CONFLICT DO NOTHING`,
    `CREATE TABLE IF NOT EXISTS asana_connections (
       id                  BIGSERIAL PRIMARY KEY,
       workspace_id        BIGINT NOT NULL REFERENCES workspaces(id),
       ciphertext          TEXT,
       key_id              TEXT,
       hint                TEXT,
       token_fingerprint   TEXT,
       asana_user_gid      TEXT,
       asana_user_name     TEXT,
       status              TEXT NOT NULL DEFAULT 'ok',
       last_error          TEXT,
       granted_by_user_id  BIGINT REFERENCES users(id),
       legacy_user_id      BIGINT REFERENCES users(id),
       created_at          BIGINT NOT NULL,
       updated_at          BIGINT NOT NULL
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_asana_connections_legacy ON asana_connections(legacy_user_id) WHERE legacy_user_id IS NOT NULL`,
    `INSERT INTO asana_connections (workspace_id, status, granted_by_user_id, legacy_user_id, created_at, updated_at)
     SELECT 1, 'ok', CASE WHEN u.kind = 'person' THEN u.id END, u.id, ${NOW}, ${NOW}
       FROM users u WHERE u.asana_api_token IS NOT NULL AND u.asana_api_token <> '' AND (u.workspace_id = 1 OR ${ANALYTICS})
     ON CONFLICT DO NOTHING`,

    // --- Discovered properties belong to a connection ---------------------------------------------------------
    `ALTER TABLE sites ADD COLUMN IF NOT EXISTS connection_id BIGINT REFERENCES google_connections(id)`,
    `ALTER TABLE sites ALTER COLUMN user_id DROP NOT NULL`,
    `UPDATE sites s SET connection_id = c.id FROM google_connections c WHERE s.connection_id IS NULL AND c.legacy_user_id = s.user_id`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_sites_connection ON sites(connection_id, source, property) WHERE connection_id IS NOT NULL`,
    `ALTER TABLE ga_properties ADD COLUMN IF NOT EXISTS connection_id BIGINT REFERENCES google_connections(id)`,
    `ALTER TABLE ga_properties ALTER COLUMN user_id DROP NOT NULL`,
    `UPDATE ga_properties g SET connection_id = c.id FROM google_connections c WHERE g.connection_id IS NULL AND c.legacy_user_id = g.user_id`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_ga_properties_connection ON ga_properties(connection_id, property_id) WHERE connection_id IS NOT NULL`,

    // --- Projects ---------------------------------------------------------------------------------------------
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id BIGINT REFERENCES workspaces(id)`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS brand_id BIGINT REFERENCES brands(id)`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id)`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS primary_manager_id BIGINT REFERENCES users(id)`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at BIGINT`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id)`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS gsc_connection_id BIGINT REFERENCES google_connections(id)`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS ga_connection_id BIGINT REFERENCES google_connections(id)`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS asana_connection_id BIGINT REFERENCES asana_connections(id)`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS spending_version INTEGER NOT NULL DEFAULT 1`,
    `UPDATE projects SET created_by = user_id WHERE created_by IS NULL`,
    // Team projects: those whose legacy owner is a team person or an analytics account. Others stay hidden (review).
    `UPDATE projects p SET workspace_id = 1 FROM users u WHERE p.workspace_id IS NULL AND u.id = p.user_id AND (u.workspace_id = 1 OR ${ANALYTICS})`,
    `UPDATE projects p SET brand_id = b.id FROM users u, brands b
      WHERE p.brand_id IS NULL AND u.id = p.user_id AND b.workspace_id = 1 AND b.email_domain = split_part(lower(u.email), '@', 2)`,
    `UPDATE projects p SET gsc_connection_id = c.id FROM google_connections c
      WHERE p.gsc_connection_id IS NULL AND p.gsc_property IS NOT NULL AND p.gsc_property <> '' AND c.legacy_user_id = p.user_id`,
    `UPDATE projects p SET ga_connection_id = c.id FROM google_connections c
      WHERE p.ga_connection_id IS NULL AND p.ga_property_id IS NOT NULL AND p.ga_property_id <> '' AND c.legacy_user_id = p.user_id`,
    `UPDATE projects p SET asana_connection_id = c.id FROM asana_connections c
      WHERE p.asana_connection_id IS NULL AND p.asana_project_gid <> '' AND c.legacy_user_id = p.user_id`,
    `CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id) WHERE deleted_at IS NULL`,
    `CREATE TABLE IF NOT EXISTS project_members (
       project_id  BIGINT NOT NULL REFERENCES projects(id),
       user_id     BIGINT NOT NULL REFERENCES users(id),
       added_by    BIGINT REFERENCES users(id),
       added_at    BIGINT NOT NULL,
       PRIMARY KEY (project_id, user_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)`,
    // A project created by a team person: that person is its initial primary manager. Projects of the analytics
    // accounts get no manager here: they need a verified human mapping (scripts/workspace/assignManagers.mts).
    `INSERT INTO project_members (project_id, user_id, added_by, added_at)
     SELECT p.id, p.user_id, p.user_id, ${NOW} FROM projects p JOIN users u ON u.id = p.user_id
      WHERE p.workspace_id = 1 AND u.kind = 'person' AND u.workspace_id = 1 AND p.deleted_at IS NULL
     ON CONFLICT DO NOTHING`,
    `UPDATE projects p SET primary_manager_id = p.user_id FROM users u
      WHERE p.primary_manager_id IS NULL AND u.id = p.user_id AND u.kind = 'person' AND u.workspace_id = 1 AND p.workspace_id = 1
        AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = p.user_id)`,

    // --- Personal settings -------------------------------------------------------------------------------------
    `CREATE TABLE IF NOT EXISTS notification_mutes (
       user_id     BIGINT NOT NULL REFERENCES users(id),
       project_id  BIGINT NOT NULL DEFAULT 0,
       category    TEXT NOT NULL,
       muted_at    BIGINT NOT NULL,
       PRIMARY KEY (user_id, project_id, category)
     )`,
    `CREATE TABLE IF NOT EXISTS scheduled_spending (
       user_id     BIGINT NOT NULL REFERENCES users(id),
       provider    TEXT NOT NULL,
       enabled     BOOLEAN NOT NULL DEFAULT false,
       version     INTEGER NOT NULL DEFAULT 1,
       updated_at  BIGINT NOT NULL,
       PRIMARY KEY (user_id, provider)
     )`,
    `ALTER TABLE project_settings ADD COLUMN IF NOT EXISTS ai_domains TEXT`,
    `INSERT INTO project_settings (project_id, ai_domains, updated_at)
     SELECT p.id, u.ga_ai_domains, ${NOW} FROM projects p JOIN users u ON u.id = p.user_id
      WHERE u.ga_ai_domains IS NOT NULL AND u.ga_ai_domains <> ''
     ON CONFLICT (project_id) DO UPDATE SET ai_domains = COALESCE(project_settings.ai_domains, EXCLUDED.ai_domains)`,

    // --- Spending attribution ----------------------------------------------------------------------------------
    `ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS payer_user_id BIGINT REFERENCES users(id)`,
    `ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS credential_fingerprint TEXT`,
    `ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS authorization_version INTEGER`,
    `ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS origin_user_id BIGINT`,
    `UPDATE ai_runs SET payer_user_id = user_id WHERE payer_user_id IS NULL`,
    `UPDATE ai_runs SET origin_user_id = user_id WHERE origin_user_id IS NULL`,
    `ALTER TABLE provider_usage ADD COLUMN IF NOT EXISTS origin_user_id BIGINT`,
    `ALTER TABLE provider_usage ADD COLUMN IF NOT EXISTS actor_user_id BIGINT`,
    `UPDATE provider_usage SET origin_user_id = user_id WHERE origin_user_id IS NULL`,
    `UPDATE provider_usage SET actor_user_id = user_id WHERE actor_user_id IS NULL`,
    `ALTER TABLE serp_snapshots ADD COLUMN IF NOT EXISTS origin_user_id BIGINT`,
    `UPDATE serp_snapshots SET origin_user_id = user_id WHERE origin_user_id IS NULL`,
    `ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS cancelled_reason TEXT`,
    // Per-project limits are personal now, so their counters are per person and project. The current counters (all
    // spent by the project's single legacy owner) carry over to that owner's new key; the old rows stay as history.
    `INSERT INTO provider_allowances (key, max_units, used_units, note, created_at, updated_at)
     SELECT 'serpapi-month:user:' || p.user_id || ':project:' || p.id || ':' || split_part(a.key, ':', 4), a.max_units, a.used_units, a.note, a.created_at, a.updated_at
       FROM provider_allowances a JOIN projects p ON a.key = 'serpapi-month:project:' || p.id || ':' || split_part(a.key, ':', 4)
      WHERE a.key LIKE 'serpapi-month:project:%'
     ON CONFLICT (key) DO NOTHING`,
    `INSERT INTO provider_allowances (key, max_units, used_units, note, created_at, updated_at)
     SELECT 'llm-usd-month:user:' || p.user_id || ':project:' || p.id || ':' || split_part(a.key, ':', 4), a.max_units, a.used_units, a.note, a.created_at, a.updated_at
       FROM provider_allowances a JOIN projects p ON a.key = 'llm-usd-month:project:' || p.id || ':' || split_part(a.key, ':', 4)
      WHERE a.key LIKE 'llm-usd-month:project:%'
     ON CONFLICT (key) DO NOTHING`,
  ],
};
