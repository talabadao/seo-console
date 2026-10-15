# Preview environment — setup and verification checklist

**Stable Preview address:** https://seo-console-git-preview-zoro-hoang.vercel.app

This is the branch URL Vercel assigns automatically to the `preview` branch. Verified 2026-10-15 in the deployment's aliases. It always serves the latest `preview` deployment.

It replaces the earlier plan for `seo-console-preview.vercel.app`. That name was never attached, so it returns 404 DEPLOYMENT_NOT_FOUND. It should not be added either: this project's Deployment Protection is **Vercel Authentication, "all except custom domains"**. A domain added under Settings → Domains would bypass the protection and make the Preview public. The automatic branch URL stays protected.

**Who can open it:** Vercel shows its own login screen first. Log in to Vercel as the owner of team **zoro-hoang**: Vercel account `tinledoihoa@gmail.com`, username `tinledoihoa-6361`, GitHub login `talabadao`. That's the only team member on the Hobby plan. After that, the app's own Google sign-in applies the five-address allowlist. One browser logged in to Vercel can test every Google account. Keep Deployment Protection on.

Never paste secret values into chat. You enter them directly into Neon, Google Cloud, Vercel or your own terminal.

## What the code guarantees (PR #5, `chore/preview-isolation`)
- In Preview (`VERCEL_ENV=preview`), the database is **only** `PREVIEW_DATABASE_URL`.
  - The production `DATABASE_URL` / `POSTGRES_*` variables that the Neon integration also exposes to Preview are ignored.
  - If `PREVIEW_DATABASE_URL` is missing, pages that need the database show an error rather than reaching production.
- Session cookies need a `SESSION_SECRET` of at least 32 characters on every deployment. The built-in development key is used only in local development.
- External writes and paid actions are refused in Preview: Asana status updates, Indexing API submissions, SerpApi review fetches and OpenAI analysis. Cron routes do nothing outside Production.
- `/api/preview-status` reports the connected database as `host/database` (never credentials) and whether writes and schedules are off. It returns 404 in Production.
- Sign-in keeps its OAuth `state` check, Google ID-token verification and the five-address allowlist (PR #4). The allowlist is the same for Preview and Production.
- Local mock mode (`V2_MOCK=1`) can't run on any Vercel deployment.

## Status on 2026-10-15

| Preview setting (branch `preview`) | State |
|---|---|
| `V2_SHELL=1` | ✅ **Set** by Claude: Preview, branch `preview`, plain |
| `GOOGLE_REDIRECT_URI` = `https://seo-console-git-preview-zoro-hoang.vercel.app/api/auth/google/callback` | ✅ **Set** by Claude: Preview, branch `preview`, plain (not a secret) |
| `PREVIEW_DATABASE_URL` (isolated database) | ❌ Missing. Step A |
| `SESSION_SECRET` (separate from production) | ❌ Missing. Step C |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ❌ Missing. Steps B and C |
| Preview schema and fixtures | ❌ Not created. Step D |

Claude didn't set the secret values itself: they would have passed through the chat transcript.

## Checklist (only the steps that need you)

### A. Separate Preview database (Vercel → Storage, Neon Free plan)
The installed Neon integration's **Free** plan allows up to 100 projects, with no payment method. A second database costs nothing. If any screen asks for a paid plan or a card, stop and tell me.

1. Vercel → team **zoro-hoang** → **Storage** → **Create Database** → **Neon** → **Continue**.
   - Plan: **Free**. Region: same as production. Database name: `seo-console-preview` → **Create**.
   - Expected: a new database listed next to the production one, with its own `ep-…` host.
2. On the **Connect Project** screen, project **seo-console**:
   - **Environments:** tick **Preview** only. Untick Production and Development.
   - **Custom Prefix:** `PREVIEW`
   - Click **Connect**.
   - Expected: under seo-console → Settings → Environment Variables, new Preview-only variables starting with `PREVIEW_`, including **`PREVIEW_DATABASE_URL`**.
   - If the variable is named differently, open the new database → **.env.local** tab → **Show secret** → copy the `DATABASE_URL` value. Then add it yourself: **Add Environment Variable**, key `PREVIEW_DATABASE_URL`, Environment **Preview**, **Sensitive** on.
   - Do **not** use a branch of the production database: a branch copies production data and keeps the production password.

### B. Google OAuth client for Preview (Google Cloud)
The callback path comes from the code: `app/api/auth/google/callback/route.ts` serves `/api/auth/google/callback`, and `lib/google/oauth.ts` sends Google the address in `GOOGLE_REDIRECT_URI`.

3. Google Cloud Console → project number **721552382367** (the one with the production client) → **APIs & Services → Credentials → + Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `SEO Console Preview`
   - Authorized JavaScript origins: `https://seo-console-git-preview-zoro-hoang.vercel.app`
   - Authorized redirect URIs: `https://seo-console-git-preview-zoro-hoang.vercel.app/api/auth/google/callback`
   - **Create**. Expected: a dialog with a new Client ID and Client secret, different from production's. Leave it open for step 5.
4. **Google Auth Platform → Audience** (older consoles: **OAuth consent screen**):
   - If Publishing status is **Testing**, under **Test users** make sure all five approved addresses are listed. Add any that are missing:
     - `analytics@headsonpillows.com`
     - `analytics@artemisdigital.com`
     - `tinledoihoa@gmail.com`
     - `tin@headsonpillows.com`
     - `tin@artemisdigital.com`
   - Expected: five test users.
   - This list belongs to the Cloud project, so production uses it too. The three new accounts need it there as well once PR #4 ships.
   - If the status is **In production**, there's nothing to add.

### C. Secret Preview variables (Vercel)
5. Vercel → **seo-console → Settings → Environment Variables → Add Environment Variable**. For each key below:
   - **Environments:** Preview only
   - **Branch:** `preview`
   - **Sensitive:** on
   - **Save**

| Key | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID from step 3 |
| `GOOGLE_CLIENT_SECRET` | Client secret from step 3 |
| `SESSION_SECRET` | A **new** random value, never production's. Generate it with the PowerShell command below, then paste into the Value field |

   This PowerShell command copies a new session secret to the clipboard without displaying it:
   ```powershell
   node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | clip
   ```

   Expected: the list shows these three plus `V2_SHELL` and `GOOGLE_REDIRECT_URI` with the **Preview (preview)** badge. The Production entries with the same names are unchanged.

   Leave these **unset in Preview**: `CRON_SECRET`, `OPENAI_API_KEY`, `PAGESPEED_API_KEY`, `ALLOW_PREVIEW_EXTERNAL_WRITES`.

### D. Build the Preview schema and synthetic fixtures (your PowerShell)
Run these in the repository folder. First copy the **Preview** connection string to the clipboard: Vercel → Storage → `seo-console-preview` → **.env.local** → copy the `DATABASE_URL` value. It's then read from the clipboard and never shown.

6. Prepare (read-only):
   ```powershell
   git checkout preview; git pull; npm install
   $env:MIGRATE_DATABASE_URL = Get-Clipboard
   npm run migrate
   ```
   Expected:
   - `Target: ep-…/neondb`. **Check that this host is the new Preview database's host (Storage → seo-console-preview), not production's, before going on.**
   - `Migrations table: not created yet`
   - `Applied: none`
   - `Pending: 0001_baseline`
7. Create the schema, with the `host/database` printed in step 6:
   ```powershell
   npm run migrate -- --apply --confirm=<host/database>
   ```
   Expected: `Applied 0001_baseline: …`. Running `npm run migrate` again shows `Pending: none`.
8. Load the synthetic fixtures:
   ```powershell
   npm run seed:preview -- --confirm=<host/database>
   ```
   Expected: `Seeded fixtures into <host/database> (user preview-fixture@example.invalid, project "Example Hotel (fixture)").` It's safe to repeat.
9. Close the PowerShell window, or run `Remove-Item Env:MIGRATE_DATABASE_URL`.

You can also save the string in a git-ignored file `.env.preview-migrate` in the repository folder, as one line `MIGRATE_DATABASE_URL=…`, and tell me. I'll then run steps 6–8 and show you the host before writing anything.

### E. Deploy and verify (Claude does this; tell me when A–C are done)
- Claude starts a fresh deployment of branch `preview`, since variables only apply to new deployments, and checks:
  - **Build:** deployment state READY. This only proves the code compiles.
  - **Isolation:** `/api/preview-status` returns `{"deployment":"preview","database":"<Preview host/database>","databaseError":null,"externalWrites":false,"schedules":false}`
  - **Usable app:** the sign-in page renders, and "Continue with Google" reaches Google's account chooser for the Preview client, not an `invalid_client` or `redirect_uri_mismatch` error.
- You then complete the sign-in itself with the approved accounts (`SMOKE-TEST.md` §3). Claude can't sign in with your Google accounts.

## Notes
- Signing in on the Preview brings that Google account's property list, and any data you open, into the **Preview** database, never production. Reset by deleting and recreating the Preview database, then repeating step D.
- The v2 demo screens (Keyword explorer, Competitors, Backlinks, Editorial board, Monthly report) show only the invented "Lumen Coast Resort (demo)" data.
- The Neon integration's production variables still list Preview as a target. The code ignores them in Preview.
- Only the `preview` branch has working sign-in. Other branch previews build, but their addresses aren't registered with Google.

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
| `/api/cron/index-check?hour=N` | 24 entries, one per hour | Sites with **Settings → Indexing automation → Auto-inspect daily** on and that hour selected. Off by default, so nothing runs until a site is opted in |
| `/api/cron/pagespeed` | 01:30, 02:30, 03:30 | Every tracked Page Speed page without a result today |

With PR #4 merged, both skip projects of accounts outside the five-address allowlist.

How to check after the next scheduled time:
- Vercel → project → **Settings → Cron Jobs**: each job's recent invocations show status 200 instead of 401. Hobby keeps runtime logs for about an hour, so look soon after a run.
- In the app: **Page Speed** shows "Last checked: today" for tracked pages after 01:30–03:30 UTC. **Indexing** shows "last check …" with today's time for opted-in sites at their chosen hour.
