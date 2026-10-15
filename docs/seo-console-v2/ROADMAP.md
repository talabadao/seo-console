# Roadmap — ordered small PRs

Each row is one reviewable PR on its own branch, merged to `main` only after its acceptance checks. Milestone numbers follow `03-ai-coding-prompts.en.md`. "Blocked by" lists owner decisions or access, not other code.

| # | Branch | Scope | Depends on | Blocked by | Acceptance |
|---|---|---|---|---|---|
| 00 | `docs/v2-repository-audit` | This audit and plan | — | — | Docs reviewed by owner |
| 01a | `chore/v2-foundations` | Rewrite stale README; add test runner; migration-history table with `0001_baseline` | 00 | Test-runner approval (AUDIT Q6) | lint/typecheck/build pass; baseline migration is a no-op on a copy of production |
| 01b | `feat/v2-shell` | App shell behind a feature flag: grouped sidebar with every spec destination, searchable project switcher with All projects, breadcrumbs, page header; legacy views mounted inside it unchanged | 01a | — | Every nav item reachable; legacy addresses still load; flag off = today's app |
| 01c | `feat/v2-primitives-demo` | MetricCard, DataTable, ChartPanel, Empty/Error/Demo states, ExportMenu; deterministic demo project (portfolio table, project dashboard, keyword table, one chart) | 01b | — | Demo works with no provider calls; desktop/mobile screenshots |
| 01d | `feat/v2-routes` | `/p/<id>/…` and `/portfolio` addresses with legacy redirect (ROUTE-MAP) | 01b | — | Old bookmarks redirect; Back/Forward; renaming a project keeps links |
| 02a | `feat/workspace-identity` | Workspaces, members, `projects.workspace_id`, shared authorization helper, backfill | 01a | Login policy (Q1); preview DB (Q4) | Rerun backfill = no duplicates; cross-workspace API requests rejected |
| 02b | `feat/encrypted-connections` | Encrypted connection store, masked reads, test-connection, move SerpApi/Asana/Bing keys | 02a | Owner creates encryption key env var | No secret in browser payloads; rotation works |
| 02c | `feat/project-settings` | Settings pages: project, mappings, KPI by project, tracking, budget | 02b | — | Existing settings preserved |
| 03 | `feat/sync-jobs-budget` | Durable jobs (Postgres-backed queue + cron tick), leases, retries, budgets; fake provider tests; job-health view; move Indexing/Reviews loops off the browser | 02a | — | Concurrency, restart and budget tests pass |
| 04 | `feat/gsc-shell-migration` | GSC Performance/Opportunities in shell with freshness/coverage, PNG/CSV export | 01c, 01d | — | Same numbers as legacy on fixtures |
| 05 | `feat/ga4-report-builder` | GA4 templates and bounded builder | 04 | — | Compatibility validation; saved views restore |
| 06 | `feat/seranking-core-import` | SE Ranking mapping + Overview/Rankings first, other tabs follow | 03 | SE Ranking API key and plan entitlements | Per-tab failures isolated; no mock on live paths |
| 07 | `feat/serp-google` (then bing, yandex, naver) | SerpApi tracking, one engine per PR | 03 | SerpApi key per project or workspace | Failed check never stored as rank 0 |
| 08 | `feat/local-reviews-import` | Merge donor Tripadvisor + coverage into host reviews; GBP public profile analysis | 03 | Donor Blob access (Q2) for history import | Idempotent sync; source-aware UI |
| 09a/b/c | `feat/indexing-queue`, `feat/psi-jobs`, `feat/site-audit` | Technical SEO, one unit per PR | 03 | Indexing API decision (Q5) | Bounded, resumable, no unrestricted submit |
| 10 | `feat/searchable-ai-area` | Searchable connector + AI Area | 03 | Searchable credentials and docs | Capability matrix verified |
| 11a/b/c | `feat/portfolio-dashboard`, `feat/asana-actions`, `feat/slack-inbox` | Dashboards, task actions, Slack | 02, 03 | Slack app credentials (11c) | Project isolation; dedupe |
| 12 | `feat/demo-<module>` | Keyword/Competitive/Link/Content/Monthly demos, one per PR | 01c | — | No network calls; Demo watermark |
| 13 | `feat/automation-docs` | Automation catalogue + Docs | 01b | Access to the GBP Post Auto Sheet/Apps Script | No external writes |
| 14 | `release/v2-rc` | Release validation, load test, rollback rehearsal | all | Owner release decision | RELEASE-CHECKLIST complete |

**Recommended first implementation milestone:** 01a (foundations), then 01b. 01a is small, unblocks honest testing for everything after it, and fixes the stale README. It needs only one decision: approval to add a test runner.
