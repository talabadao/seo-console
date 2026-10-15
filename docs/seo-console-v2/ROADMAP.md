# Roadmap — ordered small PRs

Each row is one reviewable PR on its own branch, merged to `main` only by the owner after its acceptance checks. Nothing is merged or deployed to production automatically. Milestone numbers follow `03-ai-coding-prompts.en.md`; rows marked ★ were added after the owner's decisions of 2026-10-15 (AUDIT §5).

| # | Branch | Scope | Depends on | Blocked by | Acceptance |
|---|---|---|---|---|---|
| 00 | `docs/v2-repository-audit` | Audit and plan; owner decisions recorded | — | — | Docs reviewed by owner |
| 01a (#3) | `chore/v2-foundations` | Correct the README; add Vitest with tests for existing logic and regression risks; versioned migration tooling (`db/migrations`, `scripts/migrate.mts`, `schema_migrations`) with a documented baseline — **not run against any database yet** | 00 | — | lint, typecheck, build and tests pass; no runtime behaviour change |
| ★ A (#4) | `feat/login-allowlist` | Server-side sign-in allowlist: exactly `analytics@headsonpillows.com` and `analytics@artemisdigital.com`, verified Google email; existing sessions of other accounts are rejected too. Projects and data boundaries unchanged | 01a (tests) | — | Unit tests for the allowlist and verified-email rules; no data changed |
| ★ P (#5) | `chore/preview-isolation` | App refuses production database credentials in Preview and requires `PREVIEW_DATABASE_URL`; Preview blocks external writes (Asana posts, Indexing API submits, paid fetches) unless explicitly enabled; fixture seed script | 01a | Owner creates the Preview database branch and sets variables (STATUS) | A preview deployment connects only to the Preview database; verified before any migration test |
| ★ I (#6) | `fix/indexing-eligibility` | Google Indexing API submission only for pages whose structured data declares JobPosting or a BroadcastEvent livestream; ineligible pages are not sent and use no quota; URL Inspection unchanged; "submitted" never shown as "indexed" | 01a (tests) | — | Parser tests on fixtures; ineligible URLs rejected server-side |
| 01b (#7) | `feat/v2-shell` | App shell behind `V2_SHELL`: grouped sidebar with every spec destination, searchable project switcher with All projects, portfolio, breadcrumbs, shared UI states, labelled demo screens; existing views mounted unchanged. Primitives and the first demo screens from 01c landed here too | 01a | — | Every nav item reachable; legacy addresses still load; flag off = today's app |
| 01c | `feat/v2-export` | Remaining primitives: ChartPanel, ExportMenu with PNG/copy-image, saved views; the rest of the demo interactions | 01b | — | Exports watermarked; desktop/mobile screenshots |
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
| 09d | `feat/structured-data` | **Structured Data / Schema checking engine**: read JSON-LD / microdata per tracked page, validate against schema.org types and Google's rich-result requirements, show errors and missing recommended fields with evidence. Placeholder page shipped in 01b | 03, 09c (shares the crawler) | — | Parser and rule tests on fixtures; no automated site edits |
| 10 | `feat/searchable-ai-area` | Searchable connector + AI Area (donor UI patterns) | 03 | Searchable credentials and docs | Capability matrix verified |
| 11a/b/c | `feat/portfolio-dashboard`, `feat/asana-actions`, `feat/slack-inbox` | Dashboards, task actions, Slack | 02, 03 | Slack app credentials (11c) | Project isolation; dedupe |
| 12 | `feat/demo-<module>` | Keyword/Competitive/Link/Content/Monthly demos, one per PR (donor editor patterns for Content) | 01c | — | No network calls; Demo watermark |
| 13 | `feat/automation-docs` | Automation catalogue + Docs | 01b | Access to the GBP Post Auto Sheet/Apps Script | No external writes |
| 14 | `release/v2-rc` | Release validation, load test, rollback rehearsal | all | Owner release decision | RELEASE-CHECKLIST complete |

**Merge order:** #2 → #3 → #4, #5, #6, #7 in any order. All four are stacked on #3; once #3 is merged each is retargeted to `main` and re-checked. Known overlaps, already resolved once on the `preview` branch: #4 and #5 both add an import to `lib/session.ts`; #4 and #7 both edit `app/[[...path]]/page.tsx`.

**Integration preview:** branch `preview` merges #3–#7 so they can be tested together at the stable Preview address. It is never merged into `main`; it's rebuilt from `main` plus whatever is still open.

**Out of scope:** `seo-console-official` (separate product, left unchanged); the AI Brand Mention deployment and its stored data.
