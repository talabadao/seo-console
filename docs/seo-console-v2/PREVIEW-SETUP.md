# Preview environment — setup and verification checklist

Goal: one stable Preview address, **https://seo-console-preview.vercel.app**, served from the `preview` branch. It uses an empty, separate database with synthetic fixtures, its own Google OAuth client and session key, and no production credentials, schedules, publishing or paid actions.

Never paste secret values into chat. You enter them directly into Neon, Google Cloud, Vercel or your own terminal.

## What the code guarantees (PR #5, `chore/preview-isolation`)
- In Preview (`VERCEL_ENV=preview`) the database is **only** `PREVIEW_DATABASE_URL`. The production `DATABASE_URL` / `POSTGRES_*` variables that the Neon integration also exposes to Preview are ignored. If it's missing, pages that need the database show an error rather than reaching production.
- Session cookies need a `SESSION_SECRET` of at least 32 characters on every deployment. The built-in development key is used only in local development.
- External writes and paid actions (Asana status updates, Indexing API submissions, SerpApi review fetches, OpenAI analysis) are refused in Preview. Cron routes do nothing outside Production.
- `/api/preview-status` reports the connected database as `host/database` (never credentials) and whether writes and schedules are off. It returns 404 in Production.
- Sign-in keeps its OAuth `state` check, Google ID-token verification and the two-account allowlist (PR #4).

## Checklist

### A. Separate Preview database (Neon)
1. Neon console (from Vercel: **Storage → your Neon database → Open in Neon**) → **New Project**:
   - name `seo-console-preview`
   - same region and Postgres version as production
   - **before you click Create, confirm it fits your current Neon plan.** If Neon asks for a paid upgrade, stop and tell me.
   - Expected: a new, empty project with its own host, shown as `ep-…` in the connection string, different from production's.
2. In the new project → **Connection details** → copy the **pooled** connection string.
   - Do **not** create a branch of the production project instead: a branch copies production data and keeps the production password.

### B. Stable Preview hostname (Vercel)
3. Vercel → project **seo-console** → **Settings → Domains → Add** `seo-console-preview.vercel.app`.
   - Connect it to the **Preview** environment, **Git branch `preview`**.
   - Expected: the domain shows as assigned to branch `preview`. The `preview` branch already exists on GitHub.

### C. Google OAuth client for Preview (Google Cloud)
The sign-in callback path comes from the code: the route `app/api/auth/google/callback/route.ts` serves `/api/auth/google/callback`, and `lib/google/oauth.ts` sends Google the address in `GOOGLE_REDIRECT_URI`.

4. Google Cloud Console → the project that owns the production OAuth client (project number **721552382367**) → **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `SEO Console Preview`
   - Authorized JavaScript origins: `https://seo-console-preview.vercel.app`
   - Authorized redirect URIs: `https://seo-console-preview.vercel.app/api/auth/google/callback`
   - Expected: a new client ID and secret, separate from production's. Keep the secret for step 5.
5. **OAuth consent screen → Audience**: if the app is in **Testing**, make sure `analytics@headsonpillows.com` and `analytics@artemisdigital.com` are listed as test users.

### D. Vercel environment variables
6. Vercel → **seo-console → Settings → Environment Variables**. Add each of these with **Environment = Preview only** (untick Production and Development) and **Sensitive** on:

| Key | Value | Scope |
|---|---|---|
| `PREVIEW_DATABASE_URL` | Pooled connection string from step 2 | Preview |
| `SESSION_SECRET` | A **new** random value, different from production's (command below) | Preview |
| `GOOGLE_CLIENT_ID` | Client ID from step 4 | Preview |
| `GOOGLE_CLIENT_SECRET` | Client secret from step 4 | Preview |
| `GOOGLE_REDIRECT_URI` | `https://seo-console-preview.vercel.app/api/auth/google/callback` | Preview |
| `V2_SHELL` | `1` (turns on the new console shell, PR 01b; leave unset in Production) | Preview |

Generate the session secret locally; copy the output straight into Vercel:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Leave these **unset in Preview**: `CRON_SECRET`, `OPENAI_API_KEY`, `PAGESPEED_API_KEY`, `ALLOW_PREVIEW_EXTERNAL_WRITES`.

The existing Production-scoped `GOOGLE_*` and `SESSION_SECRET` entries stay as they are. Vercel keeps a separate value per environment for the same key.

### E. Build the Preview schema and fixtures (your terminal)
Run these in the repository on branch `preview` (or `chore/preview-isolation`), after `npm install`. Use the connection string from step 2 in place of `<preview-connection-string>`.

7. Check the target (read-only):
   ```bash
   MIGRATE_DATABASE_URL='<preview-connection-string>' npm run migrate
   ```
   Expected:
   - `Target: ep-…/neondb` — **confirm this host is the Preview project's, not production's, before going on**
   - `Migrations table: not created yet`
   - `Applied: none`
   - `Pending: 0001_baseline`
8. Create the schema. Use the `host/database` printed in step 7:
   ```bash
   MIGRATE_DATABASE_URL='<preview-connection-string>' npm run migrate -- --apply --confirm=<host/database>
   ```
   Expected: `Applied 0001_baseline: Schema as of production 05f0c1d …`
9. Re-check:
   ```bash
   MIGRATE_DATABASE_URL='<preview-connection-string>' npm run migrate
   ```
   Expected: `Applied: 0001_baseline`, `Pending: none`.
10. Load synthetic fixtures:
    ```bash
    MIGRATE_DATABASE_URL='<preview-connection-string>' npm run seed:preview -- --confirm=<host/database>
    ```
    Expected: `Seeded fixtures into <host/database> (user preview-fixture@example.invalid, project "Example Hotel (fixture)").` Running it again prints the same line and creates no duplicates.

### F. Deploy and verify the Preview
11. Redeploy branch `preview` (Vercel → Deployments → latest `preview` deployment → **Redeploy**, so the new variables apply), or tell me and I'll push a fresh commit.
12. Open https://seo-console-preview.vercel.app/api/preview-status (Vercel may ask you to log in to Vercel first; previews are protected). Expected:
    ```json
    {"deployment":"preview","database":"<the Preview host/database from step 7>","databaseError":null,"externalWrites":false,"schedules":false}
    ```
13. Tell me it's done. I'll check the same endpoint and run the sign-in smoke test with you (`SMOKE-TEST.md`).

## Notes
- Signing in on the Preview brings that Google account's property list and any data you open into the **Preview** database, not production. Reset it by dropping and recreating the Preview Neon project, then repeating steps 7–10.
- The Neon integration's own variables still list Preview as a target. The code ignores them in Preview; removing Preview from them is optional, if Vercel allows editing integration-managed variables.
- Only the `preview` branch gets the stable hostname and working sign-in. Other branch previews still build, but can't sign in, because their addresses aren't registered with Google.

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

With PR #4 merged, both skip projects of accounts outside the allowlist.

How to check after the next scheduled time:
- Vercel → project → **Settings → Cron Jobs**: each job's recent invocations show status 200 instead of 401. Hobby keeps runtime logs for about an hour, so look soon after a run.
- In the app: **Page Speed** shows "Last checked: today" for tracked pages after 01:30–03:30 UTC. **Indexing** shows "last check …" with today's time for opted-in sites at their chosen hour.
