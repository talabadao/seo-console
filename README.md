# SEO Console (MVP)

A cleaner, more customizable view of **Google Search Console** performance data,
with **Bing Webmaster Tools** support and a **URL Inspection** tool for technical SEO.
Runs locally, stores data in a local SQLite file, and builds daily history over time.

## What works

| Area | Status |
| --- | --- |
| Google (Gmail) sign-in, read-only Search Console scope | ✅ |
| Auto-list your Search Console properties | ✅ |
| Performance dashboard — clicks / impressions / CTR / position | ✅ |
| **Live** GSC queries per selected range — paginates well past 1,000 rows | ✅ |
| Date presets (7d … 3y), day / week / month grain | ✅ |
| Comparison: previous period, year-over-year, previous month, custom, match-weekdays | ✅ |
| Breakdowns: Queries, Pages, Countries, Devices, Search appearance | ✅ |
| Country flags + device icons; per-row change % vs comparison | ✅ |
| Growing / Decaying / **New** tabs on every breakdown (New = "new rankings", now a filter, not a separate page) | ✅ |
| Filters: branded / non-branded, People Also Ask, long-tail, AI-prompt, Top 3/10/20, contains | ✅ |
| **Indexing** tab — automated sitemap discovery + quota-aware URL Inspection, stacked history chart, per-URL table | ✅ |
| **Submit to Index** button (Google Indexing API) for not-indexed / "unknown to Google" URLs | ⚙️ enable the Indexing API + reconnect once — see below |
| Single URL Inspection tool (24h cache) | ✅ |
| Sortable / filterable tables, **show-all rows**, CSV export | ✅ |
| Light / dark / system theme | ✅ |
| Daily snapshot storage + `npm run sync` (also runs the index check) | ✅ |
| **Analytics** tab — GA4: Organic vs AI Search sessions, Source/Medium, Key Events (+ per-event breakdown by referrer / landing page / page path), Revenue, Geo | ✅ needs the GA4 APIs enabled + reconnect |
| Bing Webmaster Tools (traffic + crawl) | ⚙️ site list stored on connect; data panels not built yet |

### Filter definitions (tune per property in **Settings**)

- **Branded** — query contains any of your brand terms (seeded from the domain, editable).
- **People Also Ask** — query contains a question word / particle, in English, Vietnamese,
  French, German, Spanish, Russian, Chinese, Japanese or Korean.
- **Long-tail** — query has ≥ N words (default 4).
- **AI search prompts** — position `=` 1.0 **and** impressions < 10 (operator, value and
  ceiling all configurable).
- **New** — appears in the current range with impressions, absent in the comparison range.
  The Growing / Decaying / New tabs use the previous period as their baseline automatically,
  even with no visible comparison selected.

## "Submit to Index" (Google Indexing API)

Google has **no public API** behind the GSC "Request indexing" button. The closest thing is
the **Indexing API**, which Google officially supports **only for pages with `JobPosting` or
`BroadcastEvent` structured data** — for other pages it may still help, with no guarantee.
This app exposes it as a best-effort nudge for URLs that come back **not indexed** or
**"URL is unknown to Google"**.

**Setup (uses your Google login — no service-account key needed):**

1. **APIs & Services → Library** → enable **Web Search Indexing API** in the same Cloud project.
2. **APIs & Services → OAuth consent screen → Data access → Add or remove scopes** → add
   `https://www.googleapis.com/auth/indexing` → Save.
3. **Sign out of SEO Console and sign back in.** The consent screen now also asks for
   "Submit data to the Web Search Indexing API" — approve it. (Your old sign-in token
   can't gain the scope; you must re-consent — the app shows a red "Reconnect Google"
   banner until you do.)
4. The signed-in account must be an **Owner** of the property in Search Console
   (Settings → Users and permissions), not just a full/restricted user.

The Indexing tab then shows a **Submit** button per eligible URL and a bulk
"Submit N not-indexed to Google" button. Submissions and their result are recorded per URL.

> This path is unaffected by the `iam.disableServiceAccountKeyCreation` org policy that
> blocks downloadable service-account keys. If you *do* have a service-account key, you can
> still point `GOOGLE_SA_KEY_FILE` / `GOOGLE_SA_KEY_JSON` at it as a fallback.

### Known API limits (Google's, not ours)

- **No bulk "Pages / Index Coverage" API.** Index/no-index is assembled from the
  **URL Inspection API**, one URL at a time, **max 2,000/day per property** (Google's limit).
  The Indexing tab discovers your sitemap URLs and inspects up to `INDEX_DAILY_CAP`
  (default 2000) per day, oldest-first, re-checking after 3 days. Each interactive
  "Run check" does `INDEX_PER_RUN_CAP` (500) so it doesn't hit the request timeout —
  click again to continue, or let the nightly `npm run sync` use the full budget.
- **No Crawl Stats API.** "Last crawl time" per URL (from URL Inspection) is the substitute;
  Bing's crawl API is richer once connected.
- Search Analytics data is final after ~2 days; the live view uses `dataState=all` so recent
  days are shown but may still shift slightly.

## Setup

### 1. Google Cloud

In [Google Cloud Console](https://console.cloud.google.com/):

1. **APIs & Services → Library →** enable **Google Search Console API**
   (and **Web Search Indexing API** if you want the "Submit to Index" button).
2. **APIs & Services → OAuth consent screen:**
   - User type: **External**
   - Add scope `.../auth/webmasters.readonly` (optional; it's requested at runtime too)
   - Under **Test users**, add the Google account(s) you'll sign in with.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:3000/api/auth/google/callback`
   - Copy the **Client ID** and **Client secret**.

### 2. Environment

```bash
cp .env.local.example .env.local
```

Fill in:

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=        # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. Run

```bash
npm install
npm run dev
```

Open http://localhost:3000 → **Continue with Google** → pick a property → **Sync now**.

## Analytics (GA4)

The **Analytics** tab connects to your Google Analytics 4 properties.

1. **Google Cloud Console → APIs & Services → Library** → enable **Google Analytics Admin API**
   and **Google Analytics Data API**.
2. In SEO Console: **Sign out → Sign in** and approve the new "See Google Analytics data"
   permission (the tab shows a "Connect Google Analytics" button until you do).
3. Pick a GA4 property (every property your Google account can access is listed).

**AI Search** is not a native GA4 channel — it's defined by a list of source domains
(`chatgpt.com`, `perplexity.ai`, `gemini.google.com`, `copilot.microsoft.com`, `claude.ai`, …),
editable in **Settings**. Those sessions are removed from "Organic Search" so they don't
double-count.

### What GA4's API can't do

- **Full user-journey sequence** (the internal page *before* an event, step-by-step paths) —
  the Data API is aggregated. Per-event *referrer*, *landing page* and *fire page* are each
  available; the raw sequence needs a **BigQuery export**.
- **Raw event / user-level data** → BigQuery only.
- **Search Console query data inside GA4** → use the Performance tab (Search Console API) instead.
- `city` rows and any query with demographics are **thresholded** (small rows hidden) when
  Google Signals is on; **sampling** kicks in above ~10M events on standard properties;
  data is stable after 24–48h.

## Running it: localhost vs. a server

GitHub only **stores** the code — it doesn't run it. This is a Next.js **server** app with a
local **SQLite** database and local files, so you have two options:

| Option | Effort | Notes |
| --- | --- | --- |
| **Keep running on localhost** | none | Best for a single-user personal tool. `git pull` to update. |
| **Deploy to a persistent Node host** (Render / Railway / Fly.io / a VPS) | small | Attach a persistent disk for `data/`, set the env vars, `npm ci && npm run build && npm start`, schedule `npm run sync` daily. Update `GOOGLE_REDIRECT_URI` to the deployed `https://…/api/auth/google/callback` and add that URI in Google Cloud. |
| **Vercel / other serverless** | larger | Next.js deploys fine, but the serverless filesystem is ephemeral — SQLite won't persist. You'd swap `lib/db.ts` for a hosted Postgres (Neon/Supabase). Not done yet. |

**GitHub Pages will not work** (static hosting only; this app needs a running server).

## Daily sync (build history automatically)

`npm run sync` pulls the last 40 days for every connected property.

**Windows Task Scheduler:** Create Task → Trigger: Daily → Action: *Start a program*
- Program/script: `node` (or output of `where node`)
- Arguments: `node_modules/tsx/dist/cli.mjs scripts/sync.mts`
- Start in: this project folder

## Bing (optional, add anytime)

Bing Webmaster Tools → **Settings → API access → API Key**. Paste it into the app's
**Settings** dialog. One key covers every verified Bing site; no per-user OAuth.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · `node:sqlite` (no native deps) ·
iron-session · google-auth-library · Recharts.

Data lives in `./data/app.db` (gitignored). Delete that file to reset.

## Project layout

```
app/
  api/            auth, sites, sync, performance, index (+ /check, /submit), inspect, settings
  components/     Dashboard, Chart, DateRangePicker, FilterMenu, BreakdownTable,
                  Indexing, UrlInspector, SettingsPanel
lib/
  db.ts           schema + lazy connection + additive migrations
  dateRanges.ts   presets, comparison modes, day/week/month grain
  gscLive.ts      live paginated GSC report (totals + series + breakdown w/ deltas)
  queryFilters.ts branded / PAA / long-tail / AI-prompt / position / trend
  geo.ts          country → alpha-2 (flagsapi.com) + device labels
  indexer.ts      sitemap discovery + parse, quota-aware inspection, submit-to-index
  siteConfig.ts   per-property filter settings (brand terms, thresholds)
  google/         oauth, Search Console REST client, indexingApi (service account)
  providers/      bing.ts (Bing Webmaster client)
  sync.ts         daily history snapshots + index check
  metrics.ts      stored-snapshot helpers
scripts/sync.mts  standalone daily sync (run via Task Scheduler)
```
