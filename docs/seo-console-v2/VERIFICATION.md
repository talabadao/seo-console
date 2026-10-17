# Verification matrix: Preview release (#18–#25)

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

## C. Authenticated Preview (owner-verified)
The owner ran the authenticated checks in their own browser on **Góc Săn Deal (project 4)** and reported them complete on 2026-10-17. Per the owner's instruction they are accepted as **user-verified**, the browser-login blocker is closed, and they weren't repeated: the agent's browser pane is a separate, unsigned session, so these weren't observed by the agent. No further SerpApi requests were made by the agent.

| Check | Status | Evidence |
|---|---|---|
| Sign-in, project access, project switching | User-verified | Owner report, 2026-10-17 |
| SerpApi: account credential resolution, separate saved / verified / allowed states, blocked reasons | User-verified | Owner report; also covered by credentials.test.ts and moduleUpdate.test.ts |
| SerpApi smoke test on Góc Săn Deal within the cumulative 5-request Preview allowance; results in Organic SERP | User-verified | Owner report. `PREVIEW_SERPAPI_TEST_PROJECT_ID` set on Preview by the owner. The allowance is now one cumulative total seeded from earlier per-project usage (ef5cec5). |
| SE Ranking Overview / Rankings, Competitors, Site audit, Backlinks; Data API entitlement line | User-verified | Owner report |
| Source comparisons (SE Ranking, GSC, GA4) | User-verified | Owner report |
| Credential persistence, KPI planning 2026–2028, navigation and redirects, archive, icons, desktop and mobile | User-verified | Owner report |
| Docs publishing by both publishers; refusal for a third account | Covered by tests; Production smoke test step 6 | notifications.test.ts. `DOCS_ADMIN_EMAILS` is set on Preview. |

## C2. Release rehearsals (agent, local)
| Check | Result | Evidence |
|---|---|---|
| Production migration path (status → baseline → apply → no-op re-apply; wrong confirm refused; data kept; KPI backfill) | Pass | scripts/capacity/migrateRehearsal.ts output, PRODUCTION-PILOT.md "Rehearsals" |
| Code rollback compatibility (v1 startup statements on the migrated schema) | Pass | Same rehearsal |
| Release candidate: tests, typecheck, lint, production build | Pass | 256 tests; `next build` clean at ef5cec5; Vercel Preview build Ready |
| Release PR mergeability | Pass | `preview` contains `main` (fast-forward, 65 commits) |

## D. Still Demo or Planned
- **Demo:** Keyword explorer, Competitor overview, Backlinks, Editorial board (content workflow), Monthly report, the demo Docs examples (Preview/dev only), and demo projects (`.example`).
- **Planned:** Business Profile, Site audit, Structured data, Workflows.
- **Not used:** CMS thumbnail mapping (no CMS connection), Asana webhooks (polling instead).
