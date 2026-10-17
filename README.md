# SEO Console

An internal SEO workspace that brings Google Search Console, Google Analytics 4, indexing, page speed and Google Maps reviews together per project. It runs as a Next.js app on Vercel with a Postgres database (Neon).

The v2 redesign is planned in [`docs/seo-console-v2/`](docs/seo-console-v2/STATUS.md); `STATUS.md` there tracks progress.

## What it does today

| Tab | Source | Notes |
|---|---|---|
| Performance | Search Console API, queried live | Clicks, impressions, CTR, position; comparison periods; query/page/country/device breakdowns; filters (branded, questions, long-tail, AI prompts, Winning/Losing/New); CSV export, with the ranking URL for each query |
| Opportunities | Search Console API | Cannibalization, parent keywords, low-hanging fruit, underperforming pages, branding keywords |
| Analytics | GA4 Admin + Data APIs | Organic vs AI-search sessions, source/medium, key events with drill-downs, landing-page heatmap, geo |
| Weekly Report | GA4 + Asana | Monthly KPI targets and pacing; Asana tasks and status updates |
| Indexing | Search Console URL Inspection; Google Indexing API | Sitemap discovery, quota-aware inspection (2,000/day/property), live inspection of chosen URLs, CSV export, optional daily schedule |
| Page Speed | PageSpeed Insights API | Up to 15 pages per project, mobile and desktop, lab and field data kept separate, daily checks |
| Reviews | SerpApi (Google Maps reviews); OpenAI `gpt-4o-mini` | Fetched only on request with credit estimates; sentiment and praise/criticism aspects |

Everything is organised by **project**: a project links one brand's website to its Search Console property, GA4 property, Google Maps listing and Asana project. Each signed-in Google account sees only its own projects. Addresses follow the view (`/<project>/<tab>/<sub-tab>`).

## Architecture

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Recharts.
- Postgres through the `postgres` client (`lib/db.ts`). The schema lives in `lib/schema.ts`; versioned migrations in `db/migrations/` (see [db/migrations/README.md](db/migrations/README.md)).
- Sign-in with Google OAuth (`google-auth-library`); session in an encrypted cookie (`iron-session`).
- Provider calls run on the server only. Scheduled work runs through Vercel Cron (`vercel.json`) and requires `CRON_SECRET`.
- Deployed on Vercel; production deploys from `main`.

## Local development

You need Node.js 22 or newer and a Postgres database you can safely write to (never production).

```bash
npm install
cp .env.local.example .env.local   # then fill in the values
npm run dev
```

Open http://localhost:3000 and sign in with Google.

Google Cloud setup, in the Cloud project that owns the OAuth client:
1. Enable the **Google Search Console API**, **Google Analytics Admin API**, **Google Analytics Data API**, **Web Search Indexing API** and **PageSpeed Insights API**.
2. OAuth consent screen: add your account as a test user while the app is in Testing.
3. Credentials → OAuth client ID (Web application) with the redirect URI `http://localhost:3000/api/auth/google/callback`.

### Checks

```bash
npm run lint
npm run typecheck
npm test          # Vitest unit tests; no database or network needed
npm run build
```

### Database migrations

`npm run migrate` reports migration status for the database in `MIGRATE_DATABASE_URL` and changes nothing. Writing requires an explicit flag and confirmation; see [db/migrations/README.md](db/migrations/README.md). Until the migration rollout milestone, the app still applies the idempotent baseline schema itself when a server instance starts.

## Environment variables

See `.env.local.example` for the full list with comments. Secrets are set in the hosting provider's settings and are never committed.

| Variable | Used for |
|---|---|
| `DATABASE_URL` (or the Neon-provided `POSTGRES_URL`) | Postgres connection |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google sign-in |
| `SESSION_SECRET` | Session cookie encryption |
| `CRON_SECRET` | Authorises Vercel Cron calls to `/api/cron/*` |
| `OPENAI_API_KEY` | Review analysis (optional; star-based sentiment without it) |
| `PAGESPEED_API_KEY` | PageSpeed Insights (optional; falls back to the signed-in Google account) |
| `MIGRATE_DATABASE_URL` | Target of `npm run migrate` only |

## Provider limits worth knowing

- **Search Console** has no bulk index-coverage API: index status comes from URL Inspection, one URL at a time, at most 2,000 per property per day. Search Analytics data settles after about two days.
- **Google Indexing API** is officially supported only for pages with `JobPosting` or `BroadcastEvent` (livestream) structured data. A successful submission is a notification, not confirmation that a page is indexed. The signed-in account must be an Owner of the property.
- **GA4 Data API** returns aggregates only: no raw events, user journeys or Search Console data (those need BigQuery). Small rows can be thresholded and large properties sampled.
- **SerpApi** charges one credit per reviews page (8 reviews on the first page, 20 after); reviews are only fetched when you ask.
