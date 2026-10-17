# Capacity: 30 concurrent sessions, 80 projects

**This is a controlled test, not a live measurement.** It ran on one Windows laptop and made no paid provider calls. Live single-user numbers from authenticated Preview are reported separately in VERIFICATION.md, once they are measured.

## Setup (`scripts/capacity`, run 2026-10-17)
- **Database:** a real Postgres 18 server (embedded-postgres, local), with the app's baseline schema and every migration (0001–0011) applied through `lib/db.ts`.
- **Data:** 5 accounts (the allowlist addresses) × 16 projects = 80 projects. Each page view reads 6 sections, the dashboard's summary parts.
- **Instances:** 4 Node processes stand in for server instances. Each uses the app's own `lib/db` pool (5 connections) and the real `lib/sync` code.
- **Sessions:** 30 concurrent sessions, assigned round-robin to the 4 instances.
- **Fake providers:**
  - 150–450 ms latency (5% add 800 ms)
  - payloads the size of a detail summary
  - the real shared rate windows, at 10 requests/s per account and provider family
  - Every call is recorded in one table, so calls are counted across processes.
  - Any non-local network request is blocked, and no credentials are passed.
- **Run it:**
```bash
cd scripts/capacity && npm install
```
```bash
npx tsx scripts/capacity/run.ts
```
The command is run from the repository root.

## Results
Latency is in milliseconds. A page is 6 parallel section reads, measured inside the server process (no network or rendering). "Distinct" counts the distinct results the phase reads.

| Phase | Views | Reads | Distinct | Provider requests | p50 page | p95 page | p95 read | Errors | Hit ratio | Reads per request |
|---|---|---|---|---|---|---|---|---|---|---|
| 30 identical cold reads, 4 instances | 30 | 180 | 6 | **6** | 2,338 | 2,528 | 2,482 | 0% | 0% | 30 |
| Browse 80 projects, cold | 360 | 2,160 | 462 | 456 (6 already saved) | 7 | 1,448 | 665 | 0% | 76% | 4.7 |
| Same views, warm | 360 | 2,160 | 462 | **0** | 6 | 25 | 24 | 0% | 100% | — |
| Everything stale | 360 | 2,160 | 462 | **462** (1 per result) | 8 | 77 | 75 | 0% | 59% | 4.7 |
| Provider outage while stale | 360 | 2,160 | 462 | 462 (1 attempt each, then backoff) | 12 | 71 | 69 | 0% (stale served) | 0% | 4.7 |
| One account, new configuration (quota) | 90 | 540 | 96 | 96 | 655 | 2,955 | 1,742 | 0% | 53% | 5.6 |
| 30 manual refreshes within cooldown | 30 | 180 | 6 | **0** | 43 | 50 | 49 | 0% | 100% | — |
| 30 manual refreshes after cooldown | 30 | 180 | 6 | **6** | 88 | 95 | 93 | 0% | 100% | 30 |

**Recovery after the outage:** the durable queue ran all 462 backed-off jobs to completion (`done: 462`), using 4 lanes and the same claims as any instance.

**Quota:** the limit was 10 requests/s per credential, shared across all 4 instances.
- The most requests in any one calendar second was **10**.
- The most in any sliding second was 11. Fixed 1-second windows allow at most 2× the limit at a window boundary.

**Dedupe effectiveness:** in every phase, provider requests equal the number of results that actually needed fetching.
- The stale phase created 472 jobs for 462 results. The 10 late jobs, queued by readers that saw the old row just before its refresh finished, were skipped at claim with no request.
- Before that fix the same phase made **468** provider requests for 462 results, and the quota phase 98 for 96. The fix is in #24.

## Reading the numbers
- **Cold pages are slow by design:** a cold page waits for the provider. In the first phase, 29 of 30 sessions wait on another instance's job and poll every 250 ms. After that, browsing is served from Postgres in single-digit milliseconds (p50).
- **Stale reads never wait** for the provider: p95 was 75 ms with 30 sessions.
- **The quota phase's p95 (2.9 s) is the rate limit working:** 96 cold sections from one account share 6 buckets of 10/s.

## Not covered here (covered by unit tests on the real schema)
These cases are tested in `tests/unit/syncCache.test.ts` (18 tests):
- a crashed worker's job recovered after lease expiry
- a stale worker unable to commit, and the generation guard
- 429 with Retry-After setting a shared cool-down, with no retry storm
- ambiguous write timeouts not resent
- access errors hiding data and recovering
- an unauthorized project never fetched
- scheduled refreshes queued only for recently read results

Organic SERP's dedupe (one-hour reuse, joining identical in-flight runs, partial runs) is in `tests/unit/organicSerp.test.ts`.
