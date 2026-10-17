# Repository and deployment audit (Prompt 00)

Audit date: 2026-10-15. Read-only: no application code, dependencies, infrastructure, secrets or database state were changed. Each finding is marked **Fact** (verified in code or deployment metadata), **Inference** (reasoned from facts, not directly observed) or **Question** (needs an owner decision or access).

## 1. Snapshots and deployments

| | Host — talabadao/seo-console | Donor — tin-headsonpillows/ai-brand-mention |
|---|---|---|
| Checked-out commit | `main` @ `05f0c1dc70cd92193d4d30e80fe315efad50c551` — **matches** the blueprint snapshot | `claude/fervent-lovelace-wror83` @ `5876464af458f1447eb3049f3c5745d8e32127e6` — **matches**; it is the only branch and the default |
| Deployed SHA | **Fact:** Vercel project `seo-console` (prj_wZAyhAHB…) production = `05f0c1d`, aliased to seo-console-zoro.vercel.app | **Unverified:** no donor project in the Vercel team this audit can see. Its deployment, protection settings and env vars are unknown |
| Framework | Next.js 16.3.4, React 19.2.8, TypeScript, Tailwind 4, Recharts 3, `postgres` 3.4, iron-session 9, google-auth-library 11 | Next.js 16.3.5, React 19.2.8, `@vercel/blob`, `openai`, `@anthropic-ai/sdk`, TipTap 3, sanitize-html, fflate |
| Scripts | `dev`, `build`, `start`, `lint`, `typecheck`, `sync` (tsx) | `dev`, `build`, `start`, `lint` |
| Tests | **Fact:** none in either repo (no test files, no test runner) | none |
| Size | 36 API route files; 19 UI components | 45 API route files; 207 files under `src/`, ~30k lines of TS/TSX |

**Out of scope (owner decision, 2026-10-15):** `seo-console-official` is a separate product. It is not investigated, modified, migrated, retired or repointed, and does not block any work here. The host is the only codebase being developed.

**Donor deployment (owner decision):** AI Brand Mention runs on its own Vercel deployment, outside this team. It is used as a code reference only: its deployment is not modified, its production storage is not connected, and its historical data is not imported in this phase.

## 2. Host — feature inventory

| Feature | Main files | State |
|---|---|---|
| Sign-in | `lib/session.ts`, `lib/google/oauth.ts`, `app/api/auth/google/*` | **Fact:** Google OAuth + iron-session cookie. Any Google account can sign in and gets its own `users` row; there is no company allowlist. Scopes: webmasters.readonly, indexing, analytics.readonly |
| Projects | `lib/projects.ts`, `lib/projectMatch.ts`, `ProjectManager.tsx` | **Fact:** `projects` table scoped to `user_id`; links one GSC property, one GA4 property, Maps link + SerpApi key, Asana gid/name. No workspace, membership or sharing |
| Addresses | `app/[[...path]]/page.tsx`, `Dashboard.tsx` | **Fact:** single catch-all page; client keeps `/<project-slug>/<tab>/<sub-tab>` in sync with `history.pushState`. **The slug is derived from the mutable project name** — the spec forbids this for v2 routes |
| GSC Performance | `/api/performance`, `lib/gscLive.ts`, `BreakdownTable.tsx` | **Fact:** live GSC calls (up to 50k rows), comparison periods, client-side filters, Queries CSV with top URL |
| Opportunities | `/api/opportunities/[kind]`, `lib/opportunities.ts` | Fact: cannibalization, parent keywords, low-hanging fruit, underperforming pages, branding keywords |
| GA4 Analytics | `/api/ga/*`, `lib/ga4.ts`, `lib/gaChannels.ts`, `Analytics.tsx` | Fact: source/medium, key events with drills, landing-page heatmap, geo; AI-referral classification by configurable domains (per user) |
| Weekly Report | `/api/weekly-report/*`, `lib/weeklyReport.ts`, `lib/asana.ts` | Fact: monthly KPI targets per GA4 property and month, run-rate pacing, Asana task buckets and status updates |
| Indexing | `/api/index/*`, `lib/indexer.ts`, `lib/google/indexingApi.ts`, cron `index-check` | Fact: sitemap discovery, URL Inspection (2,000/day cap tracked per site), live manual inspection, CSV export, **Submit via Indexing API for any page** |
| Page Speed | `/api/pagespeed/*`, `lib/pagespeed.ts`, cron `pagespeed` ×3 | Fact: up to 15 pages/project, PSI mobile+desktop daily, lab vs CrUX field kept separate, origin fallback flagged |
| Reviews | `/api/reviews/*`, `lib/serpapi.ts`, `lib/reviews.ts`, `lib/reviewClassify.ts` | Fact: Google Maps reviews via SerpApi on request only, credit estimates, gpt-4o-mini classification with fixed aspect list |
| Settings | `SettingsPanel.tsx`, `/api/settings/*` | Fact: theme, Bing key, Asana token, brand terms, indexing schedule, AI-referral domains |
| Bing | `lib/providers`, `/api/settings/bing` | Fact: key stored and sites listed; **no Bing data shown anywhere** |

## 3. Investigation targets from Prompt 00

### 3.1 Stale SQLite README — **confirmed (Fact)**
`README.md` lines 5, 151–157, 177–180 describe a local `node:sqlite` database at `./data/app.db` and say Vercel/Postgres is "not done yet". The code is Postgres-only (`lib/db.ts`, `postgres` client, `DATABASE_URL`/`POSTGRES_URL`), deployed on Vercel with Neon. The README should be rewritten in the first implementation PR.

### 3.2 Donor missing-key mock fallbacks — **confirmed (Fact)**
- `src/lib/seranking/client.ts`: `isSeRankingMock()` is true whenever `SERANKING_API_KEY` is absent, and `sync.ts` then returns `mockSnapshot(...)` generated data on the live path.
- `src/lib/openai.ts`: `isMockMode()` — no OpenAI key switches review analysis to mock.
- `src/app/api/tracking/usage/route.ts` returns `mockAccountUsage()` without a key.
The spec forbids demo data as a fallback for a missing key. When adapted, these must become explicit *Not connected* states; mock data may only feed the separate Demo mode.

### 3.3 Process-local rate limits — **confirmed (Fact)**
- Donor `seranking/client.ts` `rateSlot()` spaces requests "across concurrent callers **in this instance**"; separate serverless instances do not share it.
- Donor `serpKeyPool.ts` keeps a process-lifetime `ServerKeyRotator` and **moves to the next SerpApi key on any error**, including quota exhaustion. The spec explicitly forbids rotating keys to evade a provider quota; this must not be imported.
- Host: no shared rate limiting either; `INSPECT_DELAY_MS` spacing and quota counters live in one request. The URL Inspection daily quota *is* persisted (`quota_usage` table), but per-minute limits are not coordinated across instances.

### 3.4 Deployment-dependent authorization — **confirmed in the donor (Fact)**
- 42 of 45 donor API route files contain no authentication check at all (including WordPress publishing, settings, reviews sync, image generation).
- `src/app/api/seranking/sync/route.ts`: `isAuthorized()` returns **true when no Authorization header is present** — "UI calls carry none (the deployment is access-controlled)". Security depends entirely on Vercel deployment protection, which this audit could not verify (Question).
- Host: every non-auth API route calls `currentUser()` and scopes queries by `user_id`; cron routes require `CRON_SECRET`. **However** sign-in is open to any Google account (Fact) — acceptable only because each account sees only its own rows.

### 3.5 Browser-chained background work — **confirmed in both (Fact)**
- Host Indexing (`Indexing.tsx` `runInspection`): the browser loops up to 20 rounds of `/api/index/check` until the server stops saying "Run-limit reached"; closing the tab stops the work.
- Host Reviews (`Reviews.tsx` `analyze`): classification continues only while the tab repeatedly calls `/api/reviews/classify`.
- Donor Reviews (`ReviewsTab.tsx`): `MAX_SYNC_ROUNDS` loop in the browser.
- Crons on both sides do whole-run work inside one request with a time budget (host `index-check`, `pagespeed`; donor `tracking/run`, `brand/run`, `seranking/sync`).

## 4. Other material findings

| # | Finding | Type |
|---|---|---|
| 4.1 | **Secrets are stored in plaintext columns**: `users.google_refresh_token`, `google_access_token`, `bing_api_key`, `asana_api_token`, `projects.serpapi_key`. They are never returned to the browser, but are readable by anyone with DB access. The spec requires encrypted storage with key versioning. | Fact |
| 4.2 | **Preview deployments share the production database.** All Neon variables (`DATABASE_URL`, `POSTGRES_*`, `PG*`) target both `production` and `preview` in Vercel. Every branch push (including this one) builds a preview that runs migrations against production data. The spec requires isolated preview resources. | Fact |
| 4.3 | **Migrations run implicitly** on the first query of every new server instance (`lib/db.ts` `migrate()`), as `CREATE TABLE IF NOT EXISTS` + `ensureColumn`. Additive only, but there is no migration history table, no ordering and no down path. | Fact |
| 4.4 | **Indexing API is offered for every page.** `lib/google/indexingApi.ts` itself notes it is officially supported only for JobPosting / BroadcastEvent pages, but the UI offers "Submit Index Now" for any not-indexed URL. The spec requires eligibility gating; "submitted" must never read as "indexed". | Fact |
| 4.5 | Project slugs in addresses come from the project name, so renaming a project breaks bookmarks (documented as a known limitation when shipped). | Fact |
| 4.6 | KPI targets are keyed by (user, GA4 property, month), not by project. Two projects sharing a GA4 property share targets. | Fact |
| 4.7 | AI-referral domains and the Asana token are per **user**, not per project or workspace. | Fact |
| 4.8 | Donor stores everything as JSON documents in private Vercel Blob with **read-modify-write of shared index files** (`tracking/projects.json`, `reviews/index.json`, `seranking/sites.json`). Concurrent writes can lose updates; `readJson` swallows every error as "not created yet", so an outage looks like empty data. | Fact |
| 4.9 | Donor has no notion of users or workspaces; projects are string IDs in a Blob index plus a legacy `default` project. | Fact |
| 4.10 | Donor "Brand mentions / ChatGPT mentions" calls OpenAI and Anthropic directly and computes its own visibility. The spec makes Searchable the phase 1 source of record, so this stays disabled behind an experimental boundary. | Fact |
| 4.11 | Host has two parallel review implementations once the donor is imported: host (SerpApi Google Maps + gpt-4o-mini, Postgres) and donor (Google Maps **and Tripadvisor** via SerpApi, Blob). | Fact |
| 4.12 | Neither repo has automated tests; the spec's acceptance gates (concurrency, idempotency, budget, auth boundaries) need a test runner. Adding one is a dependency decision for Milestone 01/03. | Fact |
| 4.13 | **`CRON_SECRET` is not set in Vercel.** Every cron route requires it (`app/api/cron/*` return 401 when it is missing), so the scheduled daily indexing runs and the daily Page Speed checks have most likely never run in production. Hobby log retention (1 hour) could not confirm it from logs, because a 401 writes no log line. Fix is an owner setting (see STATUS → setup steps). | Fact (missing variable, code path); Inference (jobs not running) |

## 5. Owner decisions (2026-10-15)

The six questions raised by this audit were answered by the owner:

1. **Login policy.** Users sign in with their own Google accounts. Phase 1 allows exactly five accounts, the same list for Preview and Production: `analytics@headsonpillows.com` and `analytics@artemisdigital.com`, plus `tinledoihoa@gmail.com`, `tin@headsonpillows.com` and `tin@artemisdigital.com`, added later the same day as additions. The check is enforced on the server against the verified Google identity (not by domain). Existing project ownership and data boundaries stay as they are: each account keeps its own projects; nothing is merged. Staff/manager roles are phase 2, so workspace membership and project permissions are designed in but not enabled. This replaces the earlier "single shared Google account" assumption.
   - **Consequence (Fact):** production currently holds a third user, `tinledoihoa@gmail.com`. Once the allowlist ships, that account can no longer sign in; its rows are kept untouched.
2. **Donor deployment.** Separate Vercel deployment; code reference only. No connection to its storage and no history import in this phase (see §1).
3. **seo-console-official.** Out of scope; left unchanged.
4. **Preview isolation.** Required before testing migrations or data-writing workflows: a separate Preview database (and separate storage where applicable) seeded with synthetic fixtures; no production write credentials, schedules or publishing actions in Preview. Delivered as its own PR plus owner setup steps.
5. **Indexing API.** A separate, narrowly scoped fix restricts Google Indexing API submission to supported page types (JobPosting, or BroadcastEvent livestreams), detected from the page's structured data rather than URL patterns. URL Inspection is unchanged, and a submission is never shown as confirmed indexing.
6. **Test runner.** Vitest approved, if compatible with the stack.

### Preview environment — current state (Fact, from Vercel settings)
| Variable group | Targets today | Risk |
|---|---|---|
| Neon database (`DATABASE_URL`, `POSTGRES_*`, `PG*`, `NEON_*`) | Production **and Preview** | Preview builds hold production database credentials |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `SESSION_SECRET` | Production only | Preview cannot sign anyone in today |
| `OPENAI_API_KEY`, `PAGESPEED_API_KEY` | Production only | None in Preview |
| `CRON_SECRET` | **Not set at all** | Vercel only runs crons on Production, and the cron routes reject every call without it (finding 4.13) |

**Inference:** because Preview has no Google credentials, nobody can sign in to a preview, so today the main exposure is that preview code connects to production with full credentials, and that the implicit migrations in `lib/db.ts` would run against production as soon as a preview touches the database.
