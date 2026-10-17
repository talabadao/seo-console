# Preview environment — setup and verification checklist

**Stable Preview address:** https://seo-console-git-preview-zoro-hoang.vercel.app

This is the branch URL Vercel assigns automatically to the `preview` branch. Verified 2026-10-15 in the deployment's aliases. It always serves the latest `preview` deployment.

`seo-console-preview.vercel.app` was never attached, which is why it returns 404. It should not be added either: Deployment Protection is **Vercel Authentication, "all except custom domains"**, so an added domain would make the Preview public. The branch URL stays protected.

**Who can open it:** Vercel shows its own login screen first. Log in to Vercel as the owner of team **zoro-hoang**: `tinledoihoa@gmail.com`, username `tinledoihoa-6361`, GitHub `talabadao`, the only team member. The app's own Google sign-in then applies the five-address allowlist. One browser logged in to Vercel can test every Google account.

Never paste secret values into chat.

## What the code guarantees (PR #5, `chore/preview-isolation`)
- **Database:** in Preview (`VERCEL_ENV=preview`), the database is only `PREVIEW_DATABASE_URL`. If that is unset, the code uses `PREVIEW_DATABASE_URL_DATABASE_URL`, the name Vercel's Neon integration created when the Preview database was connected with the prefix "PREVIEW_DATABASE_URL". The production `DATABASE_URL` / `POSTGRES_*` variables are never read in Preview.
- **Session key:** session cookies need a `SESSION_SECRET` of at least 32 characters on every deployment. Without it the Preview shows "Missing Preview settings" and turns sign-in off.
- **No external writes:** external writes and paid actions are refused in Preview: Asana status updates, Indexing API submissions, SerpApi review fetches, OpenAI analysis. Asana tasks are only read. Cron routes do nothing outside Production.
- **Status endpoint:** `/api/preview-status` reports the target as `host/database` (never credentials), whether the database is reachable, whether the schema exists, the recorded migrations, the safeguards, and missing setting names. It runs only SELECTs, so checking never creates anything. It returns 404 in Production.
- **Demo projects:** `POST /api/preview/demo-projects` adds three invented `.example` projects to the signed-in user's own account. It runs on Preview and in local development only. The empty All projects page shows an "Add demo projects" button for it.
- **Sign-in:** keeps its OAuth `state` check, Google ID-token verification and the five-address allowlist (PR #4).

## Verified state (2026-10-15, deployment `seo-console-7pfowr052`, commit 2982941)

| Item | State |
|---|---|
| Build | ✅ READY. This only proves the code compiles |
| Preview database target | ✅ `ep-spring-firefly-b7804i0v-pooler.c-13.us-east-1.aws.neon.tech/neondb`, from the Neon store connected to Preview only (`store_XpABIqbHrpqDlFHt`, separate from production's store) |
| Database readiness | ✅ reachable, and **empty**: no app schema, no migrations recorded. Production has the schema, so this isn't production |
| `V2_SHELL=1` | ✅ Preview, branch `preview` |
| `GOOGLE_REDIRECT_URI` | ✅ `https://seo-console-git-preview-zoro-hoang.vercel.app/api/auth/google/callback`, Preview, branch `preview`. Matches the callback route and the URI you registered on the existing OAuth client |
| External writes / schedules | ✅ off / off |
| `SESSION_SECRET` (Preview) | ❌ missing |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Preview) | ❌ missing |
| App usable | ❌ the page shows "Missing Preview settings" until the three variables above exist |
| Sign-in | not testable yet |

## Remaining steps (need you)

### 1. Rotate the exposed Preview database password
In the Neon console for `seo-console-preview` → **Roles** → the app's role → **Reset password**. Then confirm Vercel picked up the new value: Vercel → seo-console → **Settings → Environment Variables** → `PREVIEW_DATABASE_URL_DATABASE_URL` → its "Updated" time is now.

If it wasn't updated, go to Vercel → **Storage → seo-console-preview → Projects**. Disconnect `seo-console`, then **Connect Project** again with:
- **Environments:** Preview only
- **Custom Prefix:** `PREVIEW_DATABASE_URL`

**Expected:** after the next deployment, `/api/preview-status` shows `"reachable": true` with the same host.

### 2. Add three Preview variables (Vercel)
Vercel → **seo-console → Settings → Environment Variables → Add Environment Variable**. For each key:
- **Environments:** Preview only
- **Branch:** `preview`
- **Sensitive:** on
- **Save**

| Key | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | The existing client's ID: Google Cloud → APIs & Services → **Credentials** → the existing web client, the same one production uses |
| `GOOGLE_CLIENT_SECRET` | That client's secret, from the same page |
| `SESSION_SECRET` | A **new** random value, never production's. Generate it with the PowerShell command below, then paste into Value |

This command copies a fresh 64-character key to the clipboard without showing it:
```powershell
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | clip
```

**Why these aren't copied from production automatically:**
- Production's values are Sensitive, so they can't be read.
- Extending the production entries to Preview would expose them to every PR preview. Only the `preview` branch includes the isolation code; other PR previews still read the production database through the Neon integration.
- A Preview entry limited to branch `preview` avoids both problems.

**Expected:** six variables with the "Preview (preview)" badge: these three plus `V2_SHELL` and `GOOGLE_REDIRECT_URI`. The Production entries are unchanged.

### 3. OAuth audience (Google Cloud), separate from the app's allowlist
Google decides who may *start* sign-in; the app's allowlist decides who may *use* SEO Console. Both must pass.

In Google Cloud → **Google Auth Platform → Audience**:
- **Publishing status Testing:** the **Test users** list must contain all five addresses. A Google account not listed is stopped by Google before the app sees it:
  - `analytics@headsonpillows.com`
  - `analytics@artemisdigital.com`
  - `tinledoihoa@gmail.com`
  - `tin@headsonpillows.com`
  - `tin@artemisdigital.com`
- **Publishing status In production:** any Google account can reach the consent screen, and the app's allowlist refuses everyone except the five.

The same client also needs, under **Authorized redirect URIs**, both of:
- the production callback, unchanged
- `https://seo-console-git-preview-zoro-hoang.vercel.app/api/auth/google/callback`

### 4. Tell me when 1–3 are done
I'll redeploy `preview` and check, reporting each separately:
- **Build:** READY.
- **Database:** `/api/preview-status` shows reachable. Then I'll initialize the schema.
- **App:** the sign-in page renders, and "Continue with Google" reaches Google's account chooser without `invalid_client` or `redirect_uri_mismatch`.

## Initializing the Preview schema
**Option A: I run it.** Put the rotated connection string in a git-ignored file `.env.preview-migrate` in the repository folder, as one line `MIGRATE_DATABASE_URL=…`. Tell me it's there; I never print it. I then run:
```powershell
npm run migrate:preview
npm run migrate:preview -- --apply --confirm=<host/database printed by the first command>
npm run seed:preview -- --confirm=<host/database>
```
The first command only prints the target. I'll compare it with the host above before applying.

**Option B: the app does it.** On the first sign-in, the app applies the same idempotent baseline schema to the database it's connected to: the Preview database, never production. The migration history then gets recorded the first time Option A runs.

## Demo data for approved users
After signing in on the Preview, an approved account has no projects there: the Preview database starts empty, and nothing is copied from production. On All projects, **Add demo projects** creates three invented `.example` projects owned by that account only. They show labelled demo numbers on every dashboard. Other accounts don't see them, and real projects aren't touched.

## Recommended hardening (your decision; not required for this Preview)
The production Neon store's variables (`DATABASE_URL`, `POSTGRES_*`, …) still target **Production and Preview**. Every PR preview built without PR #5 therefore reads the production database: today that's #3, #4, #6, #7 and #8. They're protected by Vercel login, and sign-in fails there because those branches have no redirect URI. Visiting one still opens a production database connection.

To close that: Vercel → **Storage → the production Neon database → Projects → seo-console → Environments**, untick **Preview**. Production is unaffected. Once #5 is merged this no longer matters for new branches, but it's safer either way.

## Production fix, separate from Preview: `CRON_SECRET` (AUDIT 4.13)
Verified 2026-10-15 in Vercel's environment variables: `CRON_SECRET` is not set for any environment. Both cron routes return 401 without it, so the scheduled jobs in `vercel.json` cannot have run.

1. Generate a value locally:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Vercel → **Settings → Environment Variables → Add**: `CRON_SECRET`, Environment **Production** only, **Sensitive**.
3. Vercel → **Deployments** → current production deployment → **Redeploy**. Variables only apply to new deployments.

Jobs that start running:

| Job | Schedule (UTC) | Runs for |
|---|---|---|
| `/api/cron/index-check?hour=N` | 24 entries, one per hour | Sites with **Settings → Indexing automation → Auto-inspect daily** on and that hour selected. Off by default |
| `/api/cron/pagespeed` | 01:30, 02:30, 03:30 | Every tracked Page Speed page without a result today |

With PR #4 merged, both skip projects of accounts outside the five-address allowlist.

How to check after the next scheduled time:
- **Vercel:** project → **Settings → Cron Jobs**. Each job's recent invocations show status 200 instead of 401.
- **In the app:**
  - Page Speed shows "Last checked: today" after 01:30–03:30 UTC.
  - Indexing shows today's "last check" for sites you've opted in.
