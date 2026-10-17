# Limited Production pilot: release plan

**Status: ready for owner approval. Nothing below has been executed on Production.** `main`, Production deployments, the Production database and Production secrets are unchanged. Every step marked **Owner** needs the owner (Production secrets aren't readable from this workspace, and changing them is the owner's call).

## Current state (2026-10-17)
- **Production:** `main` at `05f0c1d` (v1 dashboard). Its database has the v1 schema, no `schema_migrations` table, and migrations 0002–0011 are not applied (Production never self-migrates).
- **Release candidate:** `preview` at the top of the stack (#3–#25). It contains `main`, so the merge is a fast-forward (65 commits).
- **Verification:** see VERIFICATION.md. The owner verified the authenticated Preview workflows on Góc Săn Deal (project 4) in their own browser, 2026-10-17.
- **Production env names present:** `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `DATABASE_URL` (plus the Neon `POSTGRES_*` set), `OPENAI_API_KEY`, `PAGESPEED_API_KEY`.
- **Production env names missing:** `CREDENTIALS_ENCRYPTION_KEY`, `CRON_SECRET`, `SERANKING_API_KEY`, `DOCS_ADMIN_EMAILS`, `V2_SHELL`.
- **Already broken today:** because `CRON_SECRET` is missing, the v1 index-check and PageSpeed crons are refused (401). Step 4 fixes that as a side effect: those crons start running again.

## Scope of the pilot
- **Users:** the five allowlisted accounts only. Access isn't expanded.
- **Docs publishers:** exactly `tin@artemisdigital.com` and `tinledoihoa@gmail.com`.
- **Paid providers:** each account's own keys within its Budgets & limits (default 500 SerpApi requests per project per month). Model calls (OpenAI, Anthropic) and DataForSEO follow the account's daily and monthly limits.
- **SE Ranking Data API:** backlink-profile refreshes stay blocked unless `SERANKING_DATA_CREDITS_MONTH` is set (optional, see O1).
- **Preview:** unaffected. Its 5-request cumulative SerpApi allowance is Preview-only.

## Release sequence
Each step lists who does it and how to check it. Steps 1–5 change nothing users can see: v1 keeps running until step 6.

| # | Step | Who | How | Check |
|---|---|---|---|---|
| 1 | Approve the release PR | Owner | Review the draft release PR (`preview` → `main`). Don't merge yet. | Approval recorded |
| 2 | Back up the Production database | Owner | Neon console: create a branch from the Production branch named `pre-v2-pilot-2026-10-<dd>` (or note a point-in-time restore timestamp). | The branch is listed. Optionally open it read-only to confirm the data. |
| 3 | Migrate | Owner, or me with the connection string supplied privately | With Production's **unpooled** URL from Neon:<br>`MIGRATE_DATABASE_URL=… npm run migrate` (status: 0001–0011 pending)<br>`… npm run migrate -- --baseline --confirm=<host/db>`<br>`… npm run migrate -- --apply --confirm=<host/db>`<br>`… npm run migrate` (status: none pending) | Status lists 0001 (baseline) and 0002–0011 (apply). Rehearsed on a Production-shaped database; see "Rehearsals". v1 keeps working on the migrated schema. |
| 4 | Production variables | Owner | See "Variables". Generated secrets are piped straight into Vercel so they're never displayed. | `vercel env ls production` shows the names |
| 5 | Merge | Owner | Merge the release PR (fast-forward or merge commit). Vercel deploys `main` to Production automatically. `V2_SHELL` is still unset, so users keep the v1 dashboard on the new code. | The deployment is Ready. The v1 dashboard loads and shows a project's GSC numbers. |
| 6 | Turn on v2 | Owner | `vercel env add V2_SHELL production` with value `1`, then redeploy (Vercel → Deployments → Redeploy the latest Production deployment). | `/portfolio` loads for an allowlisted account |
| 7 | Smoke test | Owner, or me with a signed-in session | See "Production smoke tests". | Record results in VERIFICATION.md |
| 8 | Watch for 48 h | Owner + me | Vercel runtime errors, `/api/cron/sync` 200s at :15 every 4 h, Account → Sync & cache (jobs, failures), Usage & Costs | No unexplained errors or spend |

### Variables (step 4)
Run from a machine logged into the Vercel CLI for team `zoro-hoang`, in the linked project directory.

| Name | Required | Value | Command (never print secrets) |
|---|---|---|---|
| `CREDENTIALS_ENCRYPTION_KEY` | Yes | **New** 32 random bytes, base64. Never reuse the Preview key. Store a copy in the team secret manager. | `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" \| vercel env add CREDENTIALS_ENCRYPTION_KEY production` |
| `CREDENTIALS_ENCRYPTION_KEY_ID` | No | Defaults to `1`. Set it only when rotating. | — |
| `CRON_SECRET` | Yes | Random | `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" \| vercel env add CRON_SECRET production` |
| `DOCS_ADMIN_EMAILS` | Yes | `tin@artemisdigital.com,tinledoihoa@gmail.com` | `printf 'tin@artemisdigital.com,tinledoihoa@gmail.com' \| vercel env add DOCS_ADMIN_EMAILS production` |
| `SERANKING_API_KEY` | Yes, for the SE Ranking pages | The SE Ranking API key (the same account as Preview, or a Production-specific one) | `vercel env add SERANKING_API_KEY production` (paste at the prompt) |
| `V2_SHELL` | Step 6 only | `1` | `printf 1 \| vercel env add V2_SHELL production` |
| `LEGACY_SERVER_CREDENTIAL_ACCOUNTS` | Decision | Emails that may keep using the server's `OPENAI_API_KEY` (review classification). Unset means each account needs its own OpenAI key in API credentials. | `printf '<emails>' \| vercel env add LEGACY_SERVER_CREDENTIAL_ACCOUNTS production` |
| `SERANKING_DATA_CREDITS_MONTH` | No (O1) | Monthly Data API credits for explicit backlink refreshes (about 750 each). Unset blocks them. | `printf 3000 \| vercel env add SERANKING_DATA_CREDITS_MONTH production` |

**Not needed on Production:** `PREVIEW_*` variables. They're ignored outside Preview.

## Production smoke tests (step 7)
Use one low-risk project and an allowlisted account. No paid refreshes beyond item 5.
1. Sign in. `/portfolio` lists only that account's projects.
2. Account → API credentials: the SerpApi key shows as saved (masked). Verify it (free account check). Refresh and sign out/in: still saved.
3. Project dashboard: GSC, GA4 and SE Ranking cards load. Reload, then confirm Sync & cache shows hits and no new jobs.
4. Rank tracking → SE Ranking (Overview, Rankings), Competitors (coverage line), Technical SEO → Site audit, Link Building → Backlinks. Check the Data API entitlement line and don't refresh the profile.
5. Organic SERP: the readiness panel reads "allowed". Run one keyword at depth 10, expecting 2–4 SerpApi requests in Usage & Costs. The results render. The old `/ai-area/google-search-tracking` address redirects.
6. Docs: each publisher publishes, then unpublishes and deletes, an article titled "TEMP release test". A third allowed account sees no publish controls and gets 403 from the API.
7. KPI planning: edit one 2027 month, save, reload. Notifications bell opens.
8. Compare GSC clicks (last 28 days), GA4 organic sessions (same dates, property time zone) and SE Ranking Top 10 against the source tools. Record any differences with an explanation.

## Rollback
Pick the smallest step that fixes the problem. All three were checked against the migrated schema in the rehearsal.
1. **Turn v2 off:** unset `V2_SHELL` and redeploy. Users get the v1 dashboard on the new code. No data changes. Takes minutes.
2. **Roll the code back:** Vercel → Deployments → promote the last pre-pilot Production deployment (`05f0c1d`).
   - The migrations are additive, and the rehearsal re-ran v1's startup statements on the migrated schema without errors.
   - **Caveat:** SerpApi keys that were moved from projects into account credentials during the pilot aren't visible to v1. This happens when an account opens API credentials and the keys are identical or chosen. Re-enter those keys on the project, or use rollback 3.
3. **Restore data (only if data was damaged):** restore the step-2 Neon branch or point in time, then repeat step 3 if you go forward again.
4. **Never** delete or rotate `CREDENTIALS_ENCRYPTION_KEY` while encrypted credentials exist. Rotation means adding the old key as `CREDENTIALS_ENCRYPTION_KEYS_OLD=1:<base64>`, setting a new key with `CREDENTIALS_ENCRYPTION_KEY_ID=2`, then redeploying.

## Rehearsals done (2026-10-17, local; no Production access)
- **Migration (`scripts/capacity/migrateRehearsal.ts`):**
  - Setup: a Production-shaped database with the v1 schema and data, no `schema_migrations`, UTF-8.
  - The read-only status run lists 0001–0011 as pending.
  - `--baseline` records 0001 without running it, then `--apply` applies 0002–0011.
  - A second `--apply` reports "Nothing to apply", and a wrong `--confirm` is refused.
  - Data is preserved: the legacy project key is untouched, and the KPI backfill copies non-zero targets and leaves zeros blank.
  - Re-running v1's startup statements afterwards (what a code rollback does on boot) succeeds.
- **Load (`scripts/capacity/run.ts`):** 30 sessions, 80 projects, 4 instances, fake providers. See CAPACITY.md.

## Optional
| # | Item | Notes |
|---|---|---|
| O1 | `SERANKING_DATA_CREDITS_MONTH` | Enables explicit backlink-profile refreshes within that many Data API credits a month. First check the Data API entitlement line on Link Building → Backlinks: it uses a free call. |
| O2 | Notification thresholds | Defaults: 20% change, a minimum of 100 clicks or sessions, Top 10 ±3, average position ±3, tasks due within 3 days. Accounts can tune them. |
| O3 | Asana webhooks | Polling every 15 minutes is in place. Webhooks are a later milestone. |
| O4 | Pro plan | Not needed. The six daily sync crons, at ±59 min and 300 s each, fit Hobby, and Preview builds with the same function limits succeed. |

## Known limits going into the pilot
- **Competitors** read the top 10 for up to 100 highest-volume keywords, in batches of 40. The page states the actual coverage, and keywords beyond 100 aren't included.
- **Content-progress notifications** come from completed Asana tasks. The editorial workflow is still demo-only.
- **Thumbnails** use og:image or JSON-LD. There's no CMS connection.
- **Separate follow-up, not part of this release:** the GA4 report templates and saved custom report builder.

## Merge order
The PRs are stacked, and `preview` is a fast-forward of the top (#25).
- **Recommended:** one release PR from `preview` into `main`. The individual PRs stay as the review record, and once the release PR is merged, close them.
- **Alternative, bottom-up:** #3 → #4, #5, #6, #7 → #8 → … → #25, retargeting each to `main` (#1 and #2 are independent).
- **Migrations by PR:** 0002–0004 (#8–#14), 0005 (#14), 0006 (#15), 0007 (#16), 0008 (#19), 0009 (#21), 0010 (#22), 0011 (#23). Run step 3 before step 5.
