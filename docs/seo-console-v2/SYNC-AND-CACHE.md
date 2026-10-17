# Shared cache and durable sync jobs

Interactive pages read saved results from Postgres. Provider requests happen in **sync jobs**, which are rows in the database and shared by every server instance. Code: `lib/sync/*`. Schema: migration `0008_sync_cache`.

## Read path (`readThrough`)
| Saved result | What the reader gets | Provider requests |
|---|---|---|
| Fresh (inside its refresh interval) | The saved result | none |
| Stale (past the interval) | The last successful result, with its real fetch time, plus `refreshing` | One refresh job. Any reader on any instance joins it if it's already queued or running. |
| None (cold) | Waits up to 15 s for the one job for this query, then gets `pending` and polls | One job. Thirty identical cold reads across four processes made 6 requests for 6 sections (see CAPACITY.md). |
| Access error (401/403) | Error; the saved payload is hidden | Retried at most every 15 min, or on a manual refresh |

**Manual Refresh:**
- It joins any open job.
- Within 5 minutes of the last fetch it returns the saved result with `cooldown`.

## Cache identity
- **Key:** `(scope, cache_key)`.
- **`scope`** is `user:<id>`. A result is only served to the account whose credentials and project ownership produced it.
- **`cache_key`** is a sha256 of the kind plus the canonical query. The query includes:
  - project id
  - section
  - exact dates
  - detail flag and filters
  - for LLMs Traffic: metric, granularity and platform
  - a project **config version**
- **Config version** hashes the GSC site, GA4 property, Asana project, website, lead events, SE Ranking site, AI source domains and KPI targets. Changing any of them changes the key, so the old result is never served for the new settings.
- No credentials appear in keys or rows.
- **Before serving**, the route checks that the project belongs to the signed-in account.
- **When a job runs**, it checks again that the project still belongs to the account and that the account can still sign in (allowlist). If not, the job fails and the payload is hidden.

## Jobs
- **Open job:** one per `(scope, cache_key)`, enforced by the partial unique index `sync_jobs_one_open`. Creating a job is `INSERT … ON CONFLICT DO NOTHING`, then the caller joins the open one.
- **Lease:** each run sets `lease_until` (90 s) and a random `lease_token`.
  - A job whose worker died is picked up again once its lease expires.
  - Only the current lease holder can complete a job.
  - A worker that lost its lease gets `lost-lease` and writes nothing.
- **Generation:** each result records the id of the job that wrote it (`generation`). Results from an older job never overwrite a newer one.
- **Recheck at claim:**
  - If the result is already fresh, or a manual refresh is within its cooldown, the job finishes as `skipped` with no provider request.
  - This closes a race the capacity harness found: a reader that saw the old result just before another refresh finished used to queue and pay for a second fetch.
- **Failures:**
  - The previous result is kept, and `last_error` is shown with it.
  - Retries use bounded exponential backoff with jitter (30 s doubling, capped at 30 min, plus up to 5 s), at most 3 attempts.
  - A failed cold read is never stored as complete.
- **Provider busy (429/503 with a long Retry-After):** the job is requeued for the provider's time and doesn't use an attempt.

## Provider limits (`providerFetch`)
**Quota scopes:** rate windows are kept in Postgres per actual quota scope, so they hold across every instance:

| Scope | Limit |
|---|---|
| SE Ranking API key | 5/s |
| Search Console site | 10/s |
| GA4 property | 10/s |
| Asana token | 2/s |

**Retry-After:**
- It is honoured and sets a cool-down shared by every instance.
- Short waits happen in-request.
- Long waits become `ProviderBusyError`, and the job is rescheduled.

**What gets retried:**
- Retries cover 429, 502, 503 and 504 only, with bounded backoff.
- Network errors and timeouts are retried only for idempotent reads (GET, `runReport`, `searchAnalytics/query`). An ambiguous write is never resent.

**Paid providers:** SerpApi, OpenAI, Anthropic and DataForSEO don't use these jobs. They go through the metered ledger and budgets, and on Preview through the five-request smoke-test allowance.

## Freshness (tunable in `lib/sync/kinds.ts` `FRESH`)
| Result | Refresh after | Notes |
|---|---|---|
| Search Console summary | 6 h | GSC data lags 2–3 days. The period's end is in the key, so the overlap is re-read when the period moves. |
| GA4 summary, KPI actuals, LLMs Traffic | 2 h | GA4 reprocesses recent days. Users are never summed: they come from GA4's own deduplicated count. |
| SE Ranking (card and page) | 12 h | SE Ranking checks daily. |
| Asana tasks | 15 min | Polling. Asana webhooks aren't used yet. |
| Index coverage / health | 6 h | Local records. |
| Organic SERP | never automatic | Explicit runs only. Snapshots are permanent. |
| Docs, KPI targets, notifications | — | Local data, read directly. |

**Metric rules:**
- GA4 users are never summed across days or properties.
- GSC position is Google's impression-weighted figure for the period, never an unweighted mean of rows.

## Scheduler on the Hobby plan (no purchase)
- **Crons:** `vercel.json` has six daily `/api/cron/sync` entries (00:15, 04:15, 08:15, 12:15, 16:15, 20:15 UTC). Hobby allows daily crons within ±59 min.
- **Each tick:**
  - queues refreshes for results that are past their interval and were read in the last 7 days
  - runs due jobs, including expired leases, with 4 lanes for up to 240 s
  - runs the notification rules
- **Security:** the cron route requires `CRON_SECRET` and runs on Production only.
- **Between ticks**, refreshes also happen when someone reads a stale result (background `after()`), and through Account settings → Sync & cache → **Run queued refreshes now** (up to 10 of the account's jobs, 45 s).
- **Preview:** no schedules run. Verification uses the manual run and the tests.

## Observability (Account settings → Sync & cache)
**Per saved result:**
- last successful fetch, data-through date, next refresh
- open job (queued or refreshing, with reason and last error)
- access or last error
- hits and misses

**7-day job totals**, overall and per provider:
- queued, running and failed jobs
- provider requests
- retries
- cache hit ratio

**Also shown:**
- active provider cool-downs (bucket type only)
- a link to Usage & Costs for paid usage
