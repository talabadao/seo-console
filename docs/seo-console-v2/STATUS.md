# STATUS

_Last updated: 2026-10-16. Dashboard revisions, LLMs Traffic and the AI Area (Google Search Tracking, Brand Mentions, Usage & Costs) are on the Preview. Authenticated checks and the SerpApi smoke test are waiting for the owner's sign-in. Nothing merged into `main`, nothing deployed to Production, no production migrations or credentials changed._

## Preview: https://seo-console-git-preview-zoro-hoang.vercel.app
Vercel Authentication stays on (sign in to Vercel as the team owner, or use a share link), then Google sign-in with one of the five allowed accounts.

| Check | Result |
|---|---|
| Deployed commit | `c134ce8` on `preview` (READY). `main` unchanged at `05f0c1d` |
| Database target | Isolated Preview Neon store (`ep-spring-firefly-…/neondb`), via `/api/preview-status` |
| Schema | Present; `schema_migrations` not created yet. The app records 0001 and applies 0002 (project settings) and 0003 (AI Area) on its first signed-in database access (Preview and local only; Production never self-migrates) |
| External writes / schedules | Off / off |
| Preview variables | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `SERANKING_API_KEY` (branch `preview`, Sensitive), `V2_SHELL`, `GOOGLE_REDIRECT_URI` |
| Not set (by design for now) | `SERPAPI_API_KEY`, `PREVIEW_SERPAPI_TEST_PROJECT_ID`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DATAFORSEO_*`. Without `PREVIEW_SERPAPI_TEST_PROJECT_ID` every SerpApi call is refused on Preview |
| Authenticated checks | **Pending owner sign-in**: dashboard, All projects, Project settings, LLMs Traffic, AI Area screens, migrations recorded |
| GSC / GA4 comparison against the source UIs | **Pending** (after sign-in) |
| SerpApi smoke test (Wewine.vn, ≤ 5 requests in total) | **Not run.** Recorded consumption so far: 0 (ledger table not created yet) |

## Pull requests (all into `preview`, none into `main`)
| PR | Branch | Base | Content |
|---|---|---|---|
| #2 | `docs/v2-repository-audit` | `main` | Audit, plan, decisions, route map, roadmap, this file |
| #3–#8 | see ROADMAP | `main` / stacked | Foundations, allowlist, Preview isolation, indexing eligibility, shell, dashboards |
| #9 | `feat/v2-revisions` | `preview` | Owner revisions: sidebar, GSC insights, GA4 four metrics, SE Ranking box, KPI wording, lead events in Project settings |
| #10 | `feat/v2-llm-traffic` | #9 | Analytics → LLMs Traffic |
| #11 | `feat/ai-area-usage` | #10 | Google Search Tracking (+ Organic SERP → Google), Usage & Costs, provider ledger and caps, run locks, migration 0003 |
| #12 | `feat/ai-area-brand` | #11 | Brand Mentions |

`ce339db` (on #9) removes two local SE Ranking validation scripts that were committed by mistake in `cb4b2db`. They read the key from a local file path; no credential was committed.

## What works with real data, what's Demo, what's unavailable
- **Real (once signed in):** GSC performance and insights, GA4 four metrics and LLMs Traffic (session-scoped source), Asana work, KPI targets, SE Ranking box.
  - SE Ranking for WeWine maps to site 11734349 ("WeWine", Google Vietnam, 377 keywords).
  - For 2026-10-15 our counts match SE Ranking's own summary: Top 5 89, Top 10 169, average 27.42 (unranked counted as 100). SE Ranking shows the average as 27.
  - Top 3 (46) isn't in SE Ranking's summary.
- **AI Area: real when its provider is available, otherwise labelled unavailable** (never placeholder data).
  - Google Search Tracking and Brand Mentions' Google AI Mode / AI Overview need SerpApi. On Preview that means only the smoke-test project.
  - ChatGPT and Claude answers, answer analysis, perception summaries, prompt suggestions and the AI-vs-reviews comparison need OpenAI and Anthropic. These are refused on Preview, so Brand Mentions answers are stored as "Not analysed" there, with literal brand mentions still counted.
  - Customer reviews read the project's stored Google Maps reviews only. Tripadvisor and Google Hotels aren't connected.
- **Demo:** content progress, Monthly report, keyword/competitive/link/content modules, demo projects. Every demo value is labelled Demo.
- **Not built:** scheduled runs (AI Area, reviews refresh), Bing/Yandex/Naver tracking, Site audit, Structured data.

## Metering and caps (AI Area)
Every paid request goes through the policy check, an atomic allowance and a ledger row written before it's sent, so retries and pagination count.
- **SerpApi:**
  - Production and local: a per-project monthly cap (`AI_AREA_SERPAPI_MONTHLY_CAP`, default 500).
  - Preview: only `PREVIEW_SERPAPI_TEST_PROJECT_ID`, at most 5 requests in total, and the allowance never refills.
- **OpenAI and Anthropic:**
  - Production and local: a daily per-account limit in estimated USD (`AI_AREA_DAILY_USD_LIMIT`, default $5). Costs are estimated from recorded tokens with the pricing version `2026-10`.
  - Preview: always refused.
- **Runs:**
  - Only one running run per project and kind, and only one request working on a run at a time.
  - Runs execute in time-boxed chunks.
  - When a cap stops a run, partial results are kept.

## Checks (2026-10-16)
| Branch | typecheck | lint | tests | build |
|---|---|---|---|---|
| #11 alone | ✓ | 0 errors / 18 warnings (all pre-existing) | 135/135 | Vercel ✓ |
| #12 / `preview` | ✓ | 0 / 18 | 139/139 | Vercel ✓ (`c134ce8`; the first push `457c112` failed on a type error in a new test, fixed) |

The new tests run against an in-process Postgres (PGlite). They cover:
- caps under 12–20 concurrent requests
- failed requests counted
- no refill on resume
- Preview refusals with nothing sent or recorded
- model-call cost recording and allowance correction
- run locks, chunk leases and abandoned-run release
- partial stops
- a Brand Mentions run stopping at exactly 5 requests with its partial answers kept

## Local review
- http://localhost:3000/portfolio (mock mode, no database, no sign-in).
- AI Area screens show the mock-mode notice there, because they need a database.

## Owner actions needed
1. **Sign in on the Preview** with `tinledoihoa@gmail.com` (browser pane or the share link). This creates the migration history and applies 0002/0003 to the Preview database, and unblocks the authenticated checks and the GSC/GA4 comparison.
2. **SerpApi for the Wewine smoke test:** no SerpApi key is configured for Preview. Either:
   - save a SerpApi key on the Wewine project (Project settings → Integrations → edit the project → "Google Maps reviews" → "SerpApi key"), or
   - add `SERPAPI_API_KEY` as a Preview variable (branch `preview`, Sensitive).
   Claude then sets `PREVIEW_SERPAPI_TEST_PROJECT_ID` to Wewine's Preview project id (Preview, branch `preview`).
3. **Rotate the SE Ranking API key**, since it was pasted in chat, then update `SERANKING_API_KEY` (Preview) and Production when that's set up.
4. Earlier items still open: allowlist impact query (`SMOKE-TEST.md` §1), `CRON_SECRET` for Production, optional untick of Preview on the production Neon store's variables.
