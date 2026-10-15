# Preview environment isolation

Goal: every Preview deployment (each branch push) uses its own empty database filled with synthetic fixtures, holds no production write credentials, runs no schedules and performs no publishing or paid actions.

## What the code does (PR `chore/preview-isolation`)
- **Database.** In Preview (`VERCEL_ENV=preview`) the app connects only through `PREVIEW_DATABASE_URL`. The production variables (`DATABASE_URL`, `POSTGRES_*`) are ignored even though the Neon integration exposes them to Preview today. With `PREVIEW_DATABASE_URL` unset, a preview fails with a clear message instead of reaching production.
- **External writes are off in Preview:** Asana status updates, Google Indexing API submissions, SerpApi review fetches and OpenAI review analysis return a "disabled in Preview" error. They can be switched on for one Preview deliberately with `ALLOW_PREVIEW_EXTERNAL_WRITES=1`; leave it unset normally.
- **Schedules:** cron routes do nothing outside production. Vercel already runs cron jobs only on production, so this is a second safeguard.
- **Verification endpoint:** `GET /api/preview-status` on a preview shows the database host and name it is connected to (never credentials) and whether writes and schedules are off. It returns 404 in production.

## Owner setup steps
No secret needs to be shared in chat; you paste values directly into Neon, Vercel or your own terminal.

### 1. Create a separate Neon project for Preview (recommended)
A separate **project**, not a branch or an extra database in the production project: a branch copies production data and keeps the production role's password, and roles created in the production project can reach production tables. A separate project has its own host, its own credentials and no production data.

1. Open the Neon console (from Vercel: **Storage → your Neon database → Open in Neon**, or console.neon.tech with the same account).
2. **New Project** → name `seo-console-preview`, the same region as production, Postgres version the same as production.
3. **Before clicking Create**, check that the new project fits your current Neon plan. If Neon says it needs a paid upgrade, stop there and tell me; it's an extra cost I haven't approved for you.
4. In the new project's **Connection details**, copy the **pooled** connection string for the default database.

### 2. Add the Preview variable in Vercel
Vercel → project **seo-console** → **Settings → Environment Variables → Add**:
- **Key:** `PREVIEW_DATABASE_URL`
- **Value:** the connection string from step 1.4
- **Environments:** **Preview** only. Untick Production and Development.
- Mark it **Sensitive**, then Save.

Leave these unset for Preview: `ALLOW_PREVIEW_EXTERNAL_WRITES`, `GOOGLE_CLIENT_ID/SECRET`, `OPENAI_API_KEY`, `PAGESPEED_API_KEY`, `CRON_SECRET`.

### 3. Build the schema and load fixtures (your terminal, in the repo, on the `chore/preview-isolation` branch or later)
Replace `<preview-connection-string>` with the same string. Each command prints the target as `host/database`; use that in `--confirm`.

```bash
MIGRATE_DATABASE_URL='<preview-connection-string>' npm run migrate
```

```bash
MIGRATE_DATABASE_URL='<preview-connection-string>' npm run migrate -- --apply --confirm=<host/database>
```

```bash
MIGRATE_DATABASE_URL='<preview-connection-string>' npm run seed:preview -- --confirm=<host/database>
```

### 4. Tell me it's done
I'll then redeploy a preview and check `/api/preview-status` to confirm it reports the Preview host and database, not production. Migration tests start only after that check passes.

## Separate production fix: `CRON_SECRET` (AUDIT finding 4.13)
Not part of Preview isolation, but found during it. Scheduled indexing and Page Speed jobs need this variable and it isn't set, so they are most likely not running.

1. Generate a value locally:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Vercel → **Settings → Environment Variables → Add**: Key `CRON_SECRET`, Environments **Production** only, Sensitive, paste the value.
3. Redeploy production (Deployments → latest production → Redeploy) so the variable takes effect.

## Still open
- **Signing in to a preview** needs Google OAuth for preview addresses. Google doesn't accept wildcard redirect addresses, so this needs either a fixed preview domain or a fixture-only sign-in that works only in Preview. To be decided with the shell milestone; previews can't sign anyone in until then.
- **Separate storage:** the app stores everything in Postgres today, so the Preview database covers it. Revisit when object storage is introduced.
