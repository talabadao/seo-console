# Migration plan

Principles: additive changes only (expand → backfill → validate → contract), every backfill rerunnable without duplicates, nothing deleted in phase 1, donor left untouched.

## 0. Prerequisites (before any schema-changing PR)
1. **Separate preview database** (AUDIT 4.2). A Neon branch for Preview, seeded with synthetic fixtures. The app refuses to use the production database variables in Preview (PR `chore/preview-isolation`), and the owner points `PREVIEW_DATABASE_URL` at the branch. Steps in STATUS.md.
2. **Migration history.** Replace the implicit `migrate()` in `lib/db.ts` with numbered migration files plus a `schema_migrations` table, applied once per deploy and also safe to rerun. The existing `CREATE TABLE IF NOT EXISTS` set becomes migration `0001_baseline` (a no-op on production).
3. **Backup and restore rehearsal.** Take a Neon branch/snapshot of production and restore it into a scratch branch once, recording the steps and time.

## 1. Workspace and project identity
Current: `users` (one row per Google account) own `projects`, `sites`, `ga_properties`, `weekly_kpi_config` directly by `user_id`.

1. Add `workspaces (id, name, created_at)` and `workspace_members (workspace_id, user_id, role default 'member', created_at)`.
2. Add `projects.workspace_id` (nullable at first).
3. Backfill, deterministically, **one workspace per existing user** (owner decision: the two allowlisted accounts keep separate projects; nothing is merged). `workspace.id` is derived from the user, the user becomes its only member, and the user's projects are assigned to it. Any later sharing or merging is an explicit, reviewed action. The backfill is `INSERT … ON CONFLICT DO NOTHING` keyed on stable ids, so rerunning creates nothing new.
4. Validate (every project has a workspace; counts unchanged), then make `workspace_id` NOT NULL in a later release.
5. Authorization moves from `user_id = ?` to "user is a member of the project's workspace" through one shared helper; direct API requests use the same helper.
6. KPI targets: add `weekly_kpi_config.project_id`, backfill from the project linked to each GA4 property; keep the old key readable until validated (AUDIT 4.6).

## 2. External resource mappings
Add `project_mappings (project_id, provider, external_id, connection_id, verified_at, verified_by)` with a unique key on (project_id, provider, external_id). Existing `projects.gsc_property`, `ga_property_id`, `maps_url` are copied in as verified mappings; the old columns stay until all readers move.

## 3. Secrets
1. Add `connections (id, workspace_id, project_id null, provider, label, secret_ciphertext, key_version, masked_hint, status, last_verified_at)`.
2. Encrypt with an app key held in an environment variable (owner creates it; never printed), AES-GCM, with `key_version` for rotation.
3. Copy existing plaintext secrets (`projects.serpapi_key`, `users.asana_api_token`, `users.bing_api_key`) into encrypted connections; readers switch to connections; plaintext columns are nulled in a later release after validation. Google OAuth tokens move last because every Google feature depends on them.

## 4. Donor Blob → Postgres import — **not in this phase**
Owner decision: the donor is a code reference only. Its production storage is not connected and its history is not imported in this phase. The mapping below is kept for a possible later phase:

| Donor path | Target |
|---|---|
| `tracking/projects.json`, `tracking/<p>/config.json` | projects (explicit map), tracking contexts |
| `tracking/<p>/history/<keyword>.json` | SERP observations (nullable position, status) |
| `seranking/<p>/link.json`, `snapshot.json` | project_mappings (SE Ranking), SE Ranking snapshots |
| `reviews/index.json`, `reviews/places/<id>.json` | review sources/businesses, reviews (dedupe by source + review id) |
| `brand/<p>/*` | experimental only; not imported in phase 1 |

Import procedure: a script with `--dry-run` (default) writes a manifest — record counts, checksums per file, unmapped donor projects, conflicts — and imports nothing. A real run requires an explicit donor→host project map file, imports in batches with deterministic ids, and is safe to rerun. Sample metrics are compared against the donor UI before the new view is switched on. The donor's crons are switched off only after the host jobs are running, so no data is fetched twice.

## 5. Scheduled jobs
Current crons (host `index-check` ×24, `pagespeed` ×3) keep running until the durable job path (Milestone 03) is live; then each cron only enqueues work. Donor crons (`tracking/run`, `brand/run`, `seranking/sync`) are not copied.

## 6. Rollback
- Every release is additive, so rolling back the Vercel deployment to the previous production build is safe; new tables are simply unused.
- Feature flags switch the new shell and each migrated module off without a deploy.
- Data written by the new app stays in its own tables or nullable columns that the old code ignores.
- Contract steps (dropping plaintext columns, old keys) happen only after a full rollback window with no incidents.
