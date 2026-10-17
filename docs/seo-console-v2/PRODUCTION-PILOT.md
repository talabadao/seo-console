# Limited Production pilot: checklist

**Nothing on this list has been done.** This task made no change to `main`, to Production deployments, the Production database or Production secrets. Each step needs the owner's go-ahead at release review.

## Current state (2026-10-17)
- **Production** runs `main` at `05f0c1d`, which is the v1 dashboard.
- **v2 work** lives in stacked PRs #3–#24. Preview is at the top of the stack.
- **Production env names present:** `SESSION_SECRET`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `DATABASE_URL` (and Neon `POSTGRES_*`), `OPENAI_API_KEY`, `PAGESPEED_API_KEY`.
- **Production env names absent:** `CREDENTIALS_ENCRYPTION_KEY`, `CRON_SECRET`, `SERANKING_API_KEY`, `V2_SHELL`, `DOCS_ADMIN_EMAILS`, `LEGACY_SERVER_CREDENTIAL_ACCOUNTS`.
- **Production database:** the `schema_migrations` table and migrations 0002–0011 have not been applied. Production never self-migrates.

## Scope of the pilot
- **Users:** the five allowlisted accounts only. Access isn't expanded: the 30-session capacity test doesn't authorize more users.
- **Paid providers:** each account's own keys and its Budgets & limits.
  - The Preview five-request SerpApi rule doesn't apply on Production.
  - The Production SerpApi monthly limits from Settings do apply (default 500 per project).
- **Rollback:** switch the v2 shell off (`V2_SHELL` unset), redeploy the previous Production deployment, and leave the additive tables in place (see Rollback).

## Required before the pilot
| # | Step | How | Verify |
|---|---|---|---|
| R1 | Review and merge the stack | Merge PRs #3–#24 in order into `main`, or squash the reviewed `preview` head into a release PR. The GA4 template/custom-report proposal stays a separate milestone. | CI green; `npm test`, `npx tsc --noEmit`, `next build` |
| R2 | Back up the Production database | Neon: create a branch, or point-in-time restore point, named `pre-v2-pilot-<date>`. Record its id. | Branch is listed in Neon; restore tested on a throwaway branch |
| R3 | Baseline and migrate | 1. `MIGRATE_DATABASE_URL=… npm run migrate` (status only)<br>2. `npm run migrate -- --baseline --confirm=<host/db>` (records 0001 without running it)<br>3. `npm run migrate -- --apply --confirm=<host/db>` (applies 0002–0011)<br>Every migration is additive and runs in its own transaction. | `schema_migrations` lists 0001 (baseline) and 0002–0011 (apply) with checksums |
| R4 | Credential encryption key | Generate 32 random bytes as base64 and add them as `CREDENTIALS_ENCRYPTION_KEY` (Production only; `CREDENTIALS_ENCRYPTION_KEY_ID` = `1`). **This is a new key.** Production has no encrypted credentials yet, so nothing needs migrating. Keep it separate from `SESSION_SECRET`, never reuse the Preview key, and store a copy in the team's secret manager. | Account settings → API credentials shows "storage available"; save and remove a test key |
| R5 | Legacy credentials compatibility | Project-level SerpApi keys keep working; the resolver reads them before account keys and never overwrites them silently. Decide whether any account may keep using the server `OPENAI_API_KEY`: if yes, list exactly those emails in `LEGACY_SERVER_CREDENTIAL_ACCOUNTS`; if no, leave it unset. Every account then needs its own key. | Usage & Costs shows the key source per provider |
| R6 | Scheduler | Add `CRON_SECRET` (random, Production only). The six daily `/api/cron/sync` entries already fit the Hobby plan (daily, ±59 min). No plan purchase needed. | After the first tick, Sync & cache shows jobs, with `/api/cron/sync` 200 in the Vercel logs |
| R7 | SE Ranking | If the SE Ranking page should be live, add `SERANKING_API_KEY` (Production). Without it the page shows "isn't connected". | The SE Ranking page and dashboard card show the same Top 3/5/10 |
| R8 | Turn on the v2 shell | Set `V2_SHELL=1` on Production (the flag Preview uses). | `/portfolio` loads for an allowlisted account |
| R9 | Smoke test | Follow SMOKE-TEST.md, plus: Sync & cache, SE Ranking, Organic SERP (one Google search at depth 10 on one project), notifications bell, Docs. Compare one project's GSC clicks, GA4 sessions and SE Ranking Top 10 with the source UIs for the same dates. | Results recorded in VERIFICATION.md |

## Optional
| # | Step | Notes |
|---|---|---|
| O1 | `DOCS_ADMIN_EMAILS` | The owner names the Docs admins, a subset of the allowlist. Unset means nobody can publish (read-only Docs). |
| O2 | Notification thresholds | The defaults are 20% change, 100 clicks or sessions minimum, Top 10 ±3, average position ±3, tasks due within 3 days. Accounts can tune them in Account settings → Notifications. |
| O3 | Asana webhooks | Polling every 15 minutes is in place. Webhooks would need a public receiver and a secret: a later milestone. |
| O4 | Pro plan | Only if refreshes more often than every ~4 hours, or longer job budgets, become necessary. Not needed for the pilot. |
| O5 | Capacity re-run | `npx tsx scripts/capacity/run.ts` against a copy of production settings, if load assumptions change. |

## Rollback
1. **Redeploy:** in Vercel → Deployments, promote the last pre-pilot Production deployment (`main` at `05f0c1d`), or unset `V2_SHELL` and redeploy.
2. **Leave the new tables:** they're additive, and v1 never reads them. Don't drop anything during the rollback window.
3. **Database restore:** only if data was damaged, restore the R2 backup branch.
4. **Keep the credential key:** don't delete or rotate `CREDENTIALS_ENCRYPTION_KEY` while any encrypted credential exists.
   - Rotation means adding the current key to `CREDENTIALS_ENCRYPTION_KEYS_OLD` as `1:<base64>`, then setting a new key with id `2`, then redeploying.
   - **Never rotate in place.**

## Known limits going into the pilot
- **Content progress notifications** come from completed Asana tasks. The editorial content workflow is still demo-only and never notifies.
- **Thumbnails** use og:image or JSON-LD. There's no CMS connection, so the CMS mapping hook is unused.
- **Organic SERP** depth for Naver and Yandex is estimated per page, because SerpApi page sizes vary. The run reports the depth it actually scanned.
