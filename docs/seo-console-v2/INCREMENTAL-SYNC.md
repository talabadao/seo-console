# What "sync" means, per provider (17 Oct 2026)

Most dashboard data is a **cached query result**: the result of one provider query for one account, project, period and configuration, refreshed by re-running the whole query. That is caching, not incremental sync. Only the rows marked **incremental** below fetch just new or still-changing data and merge it into stored rows.

## How a cached result is identified
Every cached result in `report_cache` is keyed by:
- **scope** `user:<id>`, the signed-in account. Results are never shared between accounts, even for the same property.
- **kind**, for example `summary:gsc` or `seranking:overview`.
- **a canonical hash of the query**: the project ID, the period (current and comparison dates), the detail level, filters such as the LLM traffic metric, granularity and platform, and the project's **configuration version**.
  - The configuration version is a hash of the linked GSC and GA4 properties, the Asana and SE Ranking mappings, lead events, AI source domains and KPI targets. Changing any of them makes the next read fetch again instead of serving the old result.

The provider resource (property, SE Ranking site) is part of the configuration version, so changing it is a new cache identity.

**Page loads don't cause duplicate requests.**
- Identical cold reads, from any tab or server instance, join one durable job.
- A warm read makes no request.
- A stale read returns the stored result immediately and queues one refresh.
- The capacity test measured this (CAPACITY.md).

## Per provider

| Provider / data | What is stored | Fresh for | Refreshed by | Range fetched on refresh | Late or revised data | Dedupe and retries | Quota or paid budget |
|---|---|---|---|---|---|---|---|
| **Search Console: daily totals and trend** (dashboard summary) | **Incremental** (new in this change). One row per day per account's site in `perf_rows` (dimension `total`); `gsc_daily_coverage` records the covered range. The summary result is also cached. | Summary 6 h. The stored days are kept indefinitely (Google keeps ~16 months). | A page read of a stale summary; the scheduled sync every 4 h for summaries read in the last 7 days; manual refresh (5-minute cool-down). | Only days the request needs that aren't stored, plus the last **4 days as of the previous refresh** (at most once per 3 h). A historical period that is already stored makes **no request**. | The 4-day overlap is refetched and replaced in one transaction: revised days overwrite, withdrawn days disappear, nothing is counted twice. Data older than 4 days at the last refresh is final in Search Console. | Durable job per result (joined by concurrent reads). Retries with backoff (30 s doubling, max 30 min); 429 with Retry-After sets a shared cool-down. | Free. Shared window of 10 requests/s per site across instances. |
| **Search Console: top pages and queries** (detail view) | Cached query result. | 6 h | As above. | **Bounded full refresh** of the selected period and its comparison, top 1,000 rows each. | Picked up on the next refresh. | As above. | As above. |
| **Search Console: v1 dashboards** (legacy Sync button) | **Incremental.** Daily rows per dimension (total, query, page, country, device) in `perf_rows`. | Until the next Sync. | The Sync button only (no schedule). | First sync backfills 480 days; later syncs refetch the last 40 days. | Idempotent upsert per day and key, so revisions overwrite. | — | Free. |
| **GA4: dashboard summary, KPI and LLM traffic** | Cached query results. | 2 h | Stale read, the 4-hourly schedule, manual refresh. | **Bounded full refresh** of the selected period (and comparison). | Each refresh re-queries the whole period, so late or reprocessed GA4 data is picked up. | As above. | Free. Shared rate window per GA4 property across instances; 429 retries honour Retry-After. |
| **SE Ranking Project API: overview, report** | Cached results. | 12 h | Stale read, schedule, manual refresh. | Bounded: the last 180 days of position history, plus current summaries. | Picked up on the next refresh. | As above. | Subscription; no per-request cost. |
| **SE Ranking Project API: competition** | Cached result, built in resumable batches. | 24 h when complete; while incomplete, the next batch continues 10 s after the last. | As above. | Bounded; continues where the previous batch stopped (no restart). | Next full cycle after 24 h. | As above. | Subscription. |
| **SE Ranking Project API: site audit** | Cached result. | 24 h | As above. | Latest audit only. | — | As above. | Subscription. |
| **SE Ranking Data API: link profile** (Backlinks) | Cached result. | 7 days | **Manual only**: never on a page load or schedule. | Full snapshot. | — | One job per request. | **Paid credits.** Never on Preview; on Production only within `SERANKING_DATA_CREDITS_MONTH`, which is unset, so refreshes stay **disabled**. |
| **SerpApi: Google Search tracking** (AI Area) | **Append-only daily snapshots** per keyword. Not a cache. | — | Explicit run only (shows the estimate first). | Only the keywords in the run. | A rerun on the same day adds the day's result again, as a new snapshot. | One running run per project; time-boxed chunks. | **Paid.** Metered ledger, account and project caps; on Preview, the cumulative five-request allowance (not reset or increased). |
| **SerpApi: Organic SERP archive** | Saved snapshots, read only. | — | The run endpoint is retired (410). | — | — | An identical search within an hour was reused; in-flight runs were joined. | Paid (no longer callable). |
| **Asana tasks** | Cached result. | 15 min | Stale read, schedule, manual refresh. | Full task list of the mapped project. | — | As above. | Free. |
| **PageSpeed Insights** | Daily runs per tracked page and strategy in `psi_runs`. | 1 day | Daily cron at 01:30, 02:30 and 03:30 UTC; each run continues where the previous stopped. | Only pages without a successful run today. | — | Later calls the same day continue where the previous one stopped. | Free (Google API key quota). |
| **URL inspection (index check)** | Per-URL status. | 3 days | Hourly cron, per site's chosen hour. | URLs not inspected in 3 days, up to 150 per run and 2,000 per day. | — | — | Free (Search Console inspection quota). |

**Why GA4 isn't incremental:** users, active users, new users and engagement rate aren't additive across days. A user active on two days is one user for the period. Summing daily values would overcount, so GA4 totals must come from one query over the whole period. Sessions and event counts are additive, but the dashboard shows them alongside user metrics from the same query. One bounded query per period is simpler and always consistent.

**Why the Search Console page and query lists aren't incremental:** a top-1,000 list for a period can't be built from daily top-1,000 lists. A page that is never in a day's top list can still be in the period's. Storing every daily row for every page and query would be much larger than the dashboard needs.

## Scheduled-run history
`cron_runs` (migration 0012) records each **authenticated** scheduled run:
- job name;
- start and end time, and duration;
- status: ok, error, or "running or stopped" (a run killed by the function timeout never finishes);
- work processed, queued and skipped;
- a short error summary. Connection strings, tokens, keys and email addresses are removed.

A request with a wrong or missing `CRON_SECRET` is refused before a row is written. "The cron ran and nothing was due" is therefore a row with zero counts, and "the cron never ran" is no row. Rows are kept for 60 days, at most 2,000. They appear under **Account → Sync & cache → Scheduled runs**.

Until migration 0012 runs on a database, both features are inactive and everything behaves as before: no history, and the Search Console summary queries Google directly.

## Capacity review: 20–30 users
| Question | Evidence | Kind |
|---|---|---|
| 30 concurrent sessions across 4 instances, 80 projects | CAPACITY.md: warm p95 25 ms per page; cold identical reads make 6 provider requests for 30 sessions; stale reads never wait (p95 75 ms); provider outage serves stale data with 0% errors. | **Simulated providers**, real Postgres, real `lib/sync`. |
| Shared quota across instances | Never more than 10 requests in a calendar second against a 10/s limit, across 4 processes. | Simulated. |
| Concurrent cold starts | 8 instances starting together on a fresh database apply each migration once. A migrated database runs 0 schema statements at startup (`scripts/capacity/startupCheck.ts`). | Real Postgres. |
| Account isolation | 53 two-account tests: changing IDs never reads or modifies another account's data (`tests/unit/isolation.test.ts`). | Automated, real schema. |
| Incremental Search Console refresh | A warm historical period makes no request; a refresh asks for the 4-day overlap only (`tests/unit/incrementalOps.test.ts`). | Simulated provider. |
| Real provider latency and quotas | Not load tested. A paid provider load test was ruled out. Free providers (Search Console, GA4) weren't load tested against live quotas either. | **Not verified.** |

**Conclusion.** For 20–30 users, the limiting factors are the providers' own quotas and cold-page latency, not the database or the app.
- Search Console allows 1,200 requests/min per site and user.
- GA4 allows 10 concurrent requests and token buckets per property.
- With 6-hour and 2-hour freshness and refreshes only for results read in the last 7 days, the schedule stays far below them. The incremental Search Console store cuts each summary refresh from 3 requests per period pair to at most 1 small request, or none.
- The Vercel Hobby plan limits functions to their configured duration and keeps logs for one hour. Run history is now kept in the database for that reason.
