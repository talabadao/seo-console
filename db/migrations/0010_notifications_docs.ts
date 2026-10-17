import type { Migration } from "../../lib/migrations";

/**
 * In-app notifications and Docs (lib/notifications, lib/docs).
 *
 * - notifications: one row per account and event. `dedupe_key` is rule + project + period (+ item), unique per
 *   account, so the same performance change, task or digest is never notified twice however often the rules run.
 *   `source_at` is when the underlying event happened (data date, due date, publication); `read_at` is per row.
 *   Only in-app: nothing is emailed, posted to Slack or written to Asana.
 * - notification_settings: per-account thresholds and minimum volumes (JSON), and when rules last ran.
 * - doc_articles: Docs articles and news with a publication state. Only explicit Docs admins (DOCS_ADMIN_EMAILS)
 *   can create, edit or publish; every signed-in account can read published ones. `demo` marks Preview examples:
 *   they are labelled and never notified.
 */
export const migration: Migration = {
  id: "0010_notifications_docs",
  description: "In-app notifications, notification settings and Docs articles",
  statements: [
    `CREATE TABLE IF NOT EXISTS notifications (
       id          BIGSERIAL PRIMARY KEY,
       user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       project_id  BIGINT REFERENCES projects(id) ON DELETE CASCADE,
       rule        TEXT NOT NULL,
       dedupe_key  TEXT NOT NULL,
       severity    TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
       title       TEXT NOT NULL,
       body        TEXT NOT NULL,
       href        TEXT,
       source_at   BIGINT NOT NULL,
       created_at  BIGINT NOT NULL,
       read_at     BIGINT,
       UNIQUE (user_id, dedupe_key)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL`,
    `CREATE TABLE IF NOT EXISTS notification_settings (
       user_id          BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
       settings         JSONB NOT NULL DEFAULT '{}'::jsonb,
       last_run_at      BIGINT,
       updated_at       BIGINT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS doc_articles (
       id            BIGSERIAL PRIMARY KEY,
       slug          TEXT NOT NULL UNIQUE,
       kind          TEXT NOT NULL CHECK (kind IN ('article', 'news')),
       title         TEXT NOT NULL,
       summary       TEXT NOT NULL DEFAULT '',
       body          TEXT NOT NULL DEFAULT '',
       status        TEXT NOT NULL CHECK (status IN ('draft', 'published')),
       demo          BOOLEAN NOT NULL DEFAULT FALSE,
       author_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
       published_at  BIGINT,
       created_at    BIGINT NOT NULL,
       updated_at    BIGINT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_doc_articles_published ON doc_articles(status, published_at DESC)`,
  ],
};
