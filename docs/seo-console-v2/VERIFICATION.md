# Verification matrix: Preview feedback and sync release (#18–#24)

**Preview:** https://seo-console-git-preview-zoro-hoang.vercel.app. Branch `preview` is at `ed7525e`, and the Vercel deployment is Ready.

**Legend:**
- **Pass:** verified.
- **Blocked:** not verifiable yet; the reason is given.
- **Demo / Planned:** labelled as such in the product.

## A. Automated (local; `npm test` 239 tests, `tsc`, ESLint, `next build`)
| Area | Result | Evidence |
|---|---|---|
| Shared cache: warm reads make 0 provider requests; 30 identical cold reads → 1 job per section; scopes separate | Pass | syncCache.test.ts, CAPACITY.md |
| Stale result served during an outage; one refresh; backoff; max attempts; never marked complete | Pass | syncCache.test.ts, CAPACITY.md (outage) |
| Lease expiry recovery; a stale worker can't commit; generation guard; late joiners skipped | Pass | syncCache.test.ts |
| Manual refresh spam: joins the open job and respects the cooldown | Pass | syncCache.test.ts, CAPACITY.md |
| Quota per credential holds across instances; 429 Retry-After cool-down; ambiguous writes not resent | Pass | syncCache.test.ts, CAPACITY.md (max 10 per calendar second at a limit of 10) |
| Unauthorized project never fetched or served; access errors hide data and recover | Pass | syncCache.test.ts |
| Credential changes and mapping/settings changes | Pass | Config version is in the cache key (kinds.ts). Access errors retried every 15 min or on manual refresh. |
| Duplicate webhooks | n/a | Asana webhooks aren't used (polling). Notification dedupe keys make repeated rule runs idempotent (notifications.test.ts). |
| Pagination / late corrections | Pass | Organic SERP renumbers across pages and dedupes URLs. The GSC/GA4 period end is in the key, so late corrections are re-read when the period moves; GA4's 2 h refresh re-reads recent days. |
| SE Ranking page: definitions, engines never mixed, groups, history, change/new/lost, card and page parity | Pass | serankingReport.test.ts |
| Organic SERP: engine-valid params, depth/cost, stop-when-found, one-hour reuse, join in-flight, partial, refused not stored, snapshots DB-only, compare | Pass | organicSerp.test.ts (fake SerpApi only) |
| Old rank-tracking routes redirect with the engine selected | Pass | v2nav.test.ts |
| Notifications: thresholds, minimum volume, live and complete data only, dedupe, read/unread, project filter, weekly digest, settings | Pass | notifications.test.ts |
| Docs: explicit admins only, drafts hidden, publish notifies once, demo never notifies, never on Production | Pass | notifications.test.ts |
| Thumbnails: SSRF guard, on-site only (incl. redirects), size/redirect limits, og:image / JSON-LD, 7-day cache including misses | Pass | pageMeta.test.ts |
| KPI targets and credential persistence (storage) | Pass | kpiTargets.test.ts, credentials.test.ts |
| 30 sessions × 80 projects, 4 processes | Pass (controlled) | CAPACITY.md |

## B. Deployed Preview, without signing in
| Check | Result |
|---|---|
| Every new API route returns 401 without a session (notifications, settings, docs list/article/publish, organic-serp GET/POST/quote/snapshot, seranking, thumbnails, account sync, summary) | Pass (2026-10-17) |
| `/api/cron/sync` on Preview | Pass: `{"skipped":"schedules run in production only"}` |
| Build of each PR head | Pass. An early build of #19 failed (a client bundle pulled in the DB driver); fixed in #19 and caught by `next build` from then on. |

## C. Authenticated Preview: blocked until you sign in
None of these could run: nobody signed in to the Preview's Google sign-in during this task, and I can't sign in for you.

| Check | Status | Blocked on |
|---|---|---|
| Migrations 0008–0011 applied on the Preview DB (Sync & cache page loads, not 503) | Blocked | Sign-in (they apply at first DB access) |
| SerpApi key save/replace/remove; persists across refresh, navigation, sign-out/sign-in and a fresh instance; storage status separate from verification | Blocked | Sign-in, and you entering the key |
| KPI and credential persistence in the UI | Blocked | Sign-in |
| Account menu (collapsed sidebar and mobile), Docs and bell in the header, cog icon, account redirects keep filters | Blocked | Sign-in |
| SE Ranking page vs SE Ranking UI (Top 3/5/10, average) for Wewine | Blocked | Sign-in |
| GA4 and GSC numbers vs the source UIs for the same dates | Blocked | Sign-in |
| Organic SERP live Google search on Wewine (counts against the 5-request Preview allowance) | Blocked | Sign-in, plus `PREVIEW_SERPAPI_TEST_PROJECT_ID` (Wewine's project id), which isn't set on Preview, so every Preview SerpApi call is refused today |
| Notifications from real saved data; Docs (read-only: `DOCS_ADMIN_EMAILS` isn't set on Preview) | Blocked | Sign-in; admin identity is the owner's decision |
| Thumbnails on real Wewine pages | Blocked | Sign-in |
| Live single-session latency (p50/p95) on Preview | Blocked | Sign-in |
| Authenticated screenshots | Blocked | Sign-in |

## D. Still Demo or Planned
- **Demo:** Keyword explorer, Competitor overview, Backlinks, Editorial board (content workflow), Monthly report, the demo Docs examples (Preview/dev only), and demo projects (`.example`).
- **Planned:** Business Profile, Site audit, Structured data, Workflows.
- **Not used:** CMS thumbnail mapping (no CMS connection), Asana webhooks (polling instead).
