# Roadmap — ordered small PRs

Each row is one reviewable PR on its own branch, merged to `main` only by the owner after its acceptance checks. Nothing is merged or deployed to production automatically. Milestone numbers follow `03-ai-coding-prompts.en.md`; rows marked ★ were added after the owner's decisions of 2026-10-15 (AUDIT §5).

| # | Branch | Scope | Depends on | Blocked by | Acceptance |
|---|---|---|---|---|---|
| 00 | `docs/v2-repository-audit` | Audit and plan; owner decisions recorded | — | — | Docs reviewed by owner |
| 01a | `chore/v2-foundations` | Correct the README; add Vitest with tests for existing logic and regression risks; versioned migration tooling (`db/migrations`, `scripts/migrate.mts`, `schema_migrations`) with a documented baseline — **not run against any database yet** | 00 | — | lint, typecheck, build and tests pass; no runtime behaviour change |
| ★ A | `feat/login-allowlist` | Server-side sign-in allowlist: exactly `analytics@headsonpillows.com` and `analytics@artemisdigital.com`, verified Google email; existing sessions of other accounts are rejected too. Projects and data boundaries unchanged | 01a (tests) | — | Unit tests for the allowlist and verified-email rules; no data changed |
| ★ P | `chore/preview-isolation` | App refuses production database credentials in Preview and requires `PREVIEW_DATABASE_URL`; Preview blocks external writes (Asana posts, Indexing API submits, paid fetches) unless explicitly enabled; fixture seed script | 01a | Owner creates the Preview database branch and sets variables (STATUS) | A preview deployment connects only to the Preview database; verified before any migration test |
| ★ I | `fix/indexing-eligibility` | Google Indexing API submission only for pages whose structured data declares JobPosting or a BroadcastEvent livestream; ineligible pages are not sent and use no quota; URL Inspection unchanged; "submitted" never shown as "indexed" | 01a (tests) | — | Parser tests on fixtures; ineligible URLs rejected server-side |
| 01b | `feat/v2-shell` | App shell behind a feature flag: grouped sidebar with every spec destination, searchable project switcher with All projects, breadcrumbs, page header; legacy views mounted inside it unchanged | 01a, P | — | Every nav item reachable; legacy addresses still load; flag off = today's app |
| 01c | `feat/v2-primitives-demo` | MetricCard, DataTable, ChartPanel, Empty/Error/Demo states, ExportMenu; deterministic demo project (portfolio table, project dashboard, keyword table, one chart) | 01b | — | Demo works with no provider calls; desktop/mobile screenshots |
| 01d | `feat/v2-routes` | `/p/<id>/…` and `/portfolio` addresses with legacy redirect (ROUTE-MAP) | 01b | — | Old bookmarks redirect; Back/Forward; renaming a project keeps links |
| 02a | `feat/workspace-identity` | Workspaces and members; one workspace per existing user (no merging); shared authorization helper; first real migration, rehearsed in Preview | 01a, P | Preview isolation verified | Rerun backfill = no duplicates; cross-workspace API requests rejected |
| 02b | `feat/encrypted-connections` | Encrypted connection store, masked reads, test-connection; move SerpApi/Asana/Bing keys | 02a | Owner creates the encryption key variable | No secret in browser payloads; rotation works |
| 02c | `feat/project-settings` | Settings pages: project, mappings, KPI by project, tracking, budget | 02b | — | Existing settings preserved |
| 03 | `feat/sync-jobs-budget` | Durable jobs (Postgres-backed queue + cron tick), leases, retries, budgets; fake-provider tests; job-health view; Indexing/Reviews work leaves the browser | 02a | `CRON_SECRET` set (AUDIT 4.13) | Concurrency, restart and budget tests pass |
| 04 | `feat/gsc-shell-migration` | GSC Performance/Opportunities in the shell with freshness/coverage, PNG/CSV export | 01c, 01d | — | Same numbers as legacy on fixtures |
| 05 | `feat/ga4-report-builder` | GA4 templates and bounded builder | 04 | — | Compatibility validation; saved views restore |
| 06 | `feat/seranking-core-import` | Adapt donor SE Ranking code: mapping + Overview/Rankings first, other tabs follow | 03 | SE Ranking API key and plan entitlements | Per-tab failures isolated; no mock on live paths |
| 07 | `feat/serp-google` (then bing, yandex, naver) | Adapt donor tracking code; one engine per PR | 03 | SerpApi key per project or workspace | Failed check never stored as rank 0 |
| 08 | `feat/local-reviews-import` | Adapt donor Tripadvisor + coverage code into host reviews; GBP public profile analysis. No donor history import | 03 | — | Idempotent sync; source-aware UI |
| 09a/b/c | `feat/indexing-queue`, `feat/psi-jobs`, `feat/site-audit` | Technical SEO, one unit per PR (builds on ★ I) | 03 | — | Bounded, resumable, no unrestricted submit |
| 10 | `feat/searchable-ai-area` | Searchable connector + AI Area (donor UI patterns) | 03 | Searchable credentials and docs | Capability matrix verified |
| 11a/b/c | `feat/portfolio-dashboard`, `feat/asana-actions`, `feat/slack-inbox` | Dashboards, task actions, Slack | 02, 03 | Slack app credentials (11c) | Project isolation; dedupe |
| 12 | `feat/demo-<module>` | Keyword/Competitive/Link/Content/Monthly demos, one per PR (donor editor patterns for Content) | 01c | — | No network calls; Demo watermark |
| 13 | `feat/automation-docs` | Automation catalogue + Docs | 01b | Access to the GBP Post Auto Sheet/Apps Script | No external writes |
| 14 | `release/v2-rc` | Release validation, load test, rollback rehearsal | all | Owner release decision | RELEASE-CHECKLIST complete |

**Merge order:** 00 → 01a → (A, P, I in any order; each is independent of the others) → 01b. The shell work (01b–01d) starts once 01a is merged and Preview isolation is verified.

**Out of scope:** `seo-console-official` (separate product, left unchanged); the AI Brand Mention deployment and its stored data.
