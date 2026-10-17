# STATUS

_Last updated: 2026-10-16. Credential fix, account credentials, Settings consolidation, KPI planning and the first consistency batch are on the Preview. The authenticated browser checks are waiting for the owner's sign-in. Nothing merged into `main`, nothing deployed to Production, no production migrations or credentials changed._

## Preview: https://seo-console-git-preview-zoro-hoang.vercel.app
Vercel Authentication stays on. Sign in to Vercel as the team owner (or use a share link), then use Google sign-in with one of the five allowed accounts.

| Check | Result |
|---|---|
| Deployed commit | `5850e15` on `preview`. `main` unchanged at `05f0c1d` |
| Database | Isolated Preview Neon store (`ep-spring-firefly-…`). Migrations 0001–0007 apply on the first signed-in database access (Preview and local only). Production never self-migrates |
| External writes / schedules | Off / off |
| Preview variables | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `SERANKING_API_KEY`, `CREDENTIALS_ENCRYPTION_KEY` (new; created once via the CLI, never printed, separate from `SESSION_SECRET`), `V2_SHELL`, `GOOGLE_REDIRECT_URI` |
| Not set (by design) | `PREVIEW_SERPAPI_TEST_PROJECT_ID` (needs Wewine's Preview project id after sign-in), `LEGACY_SERVER_CREDENTIAL_ACCOUNTS`, server provider keys |
| SerpApi smoke test (Wewine.vn, ≤ 5 requests in total) | Not run. Recorded consumption: 0 (the ledger table is created on first sign-in) |
| Authenticated browser checks | **Pending owner sign-in** |

## Pull requests (all into `preview`, none into `main`)
| PR | Branch | Base | Content |
|---|---|---|---|
| #2 | `docs/v2-repository-audit` | `main` | Audit, plan, decisions, route map, roadmap, this file |
| #3–#12 | see ROADMAP | stacked | Foundations through AI Area (Brand Mentions) |
| #13 | `fix/serpapi-credential-persistence` | `preview` | SerpApi key persistence fix and honest status |
| #14 | `feat/account-credentials` | #13 | Encrypted account credentials, one resolver, legacy key migration (0005) |
| #15 | `feat/settings-usage-budgets` | #14 | Usage & Costs and Budgets & limits in Settings, combined limits, redirects (0006) |
| #16 | `feat/kpi-planning` | #15 | Multi-month KPI planning, one source of targets (0007) |
| #17 | `feat/consistency-review` | #16 | One Settings, one SerpApi budget (Maps reviews metered), aligned AI navigation and wording |

**Fixed on the way.** Migrations 0005 and 0006 were added without being registered, so their tables wouldn't have been created on Preview. They are now registered on #14 and #15, and a test checks that every migration file is registered.

## The SerpApi credential bug (Part 1)
- **Cause (code trace):**
  - Saving the key rode on the project update, which validated the Maps link, website, favicon and GSC/GA mappings first. Any unrelated invalid field failed the whole save with a misleading error.
  - The key's saved state only showed as "Reviews set up", which also needed a Maps link.
- **Fix:** keys are saved on their own and reported as Saved / Not configured, masked identifier, last updated, plus a separate free connection check.
  - Since #14, keys live in the encrypted account store.
  - Legacy project keys keep working until consolidated or resolved.
- **Live reproduction and cross-session checks in the authenticated Preview:** pending sign-in.

## What works with real data, what's Demo, what's unavailable
- **Real once signed in:**
  - GSC, GA4 four metrics, LLMs Traffic
  - Asana work
  - SE Ranking box (WeWine validated: Top 5 89 / Top 10 169 / average 27.42 vs SE Ranking's 27)
  - KPI planning and the KPI cards that read it
  - Account credentials (storage + free checks)
  - Usage & Costs (recorded and provider-reported where configured)
  - Budgets & limits
- **AI Area:** real when its provider is available, otherwise labelled unavailable.
  - On Preview: SerpApi only for the smoke-test project; OpenAI and Anthropic always refused, even with saved keys.
  - Brand Mentions answers are stored as "Not analysed" there.
- **Demo:**
  - content progress
  - Monthly report
  - keyword, competitive, link and content modules
  - demo projects
- **Planned:** SE Ranking full module, Bing/Yandex/Naver tracking, Business Profile, Site audit, Structured data, Automation, Docs, scheduled runs.

## Automated checks (2026-10-16)
- typecheck clean.
- Lint: 0 errors, 17 warnings, all pre-existing.
- 181 tests pass. New suites (PGlite, the KPI suite on the real baseline schema plus all migrations):
  - **credentials**: encryption binding and rotation, save / replace / remove, placeholders, DataForSEO fields, isolation, persistence across a fresh module instance, resolver order, consolidation and conflicts
  - **budgets**: defaults, validation, combined limits with refunds, concurrency, mid-period changes, Preview allowance intact, history intact, redirects, shared budget with Maps reviews
  - **KPI**: backfill and re-run, time zone, cross-year 2026–2027 and 2027–2028 plans, blank vs zero, validation, all-or-nothing rollback, concurrent edits, dashboard / Weekly report consistency
- Vercel builds READY for every pushed commit.

## Owner actions needed
1. **Sign in on the Preview** (the browser pane is open at the sign-in page). This unblocks:
   - migrations 0001–0007 on the Preview database
   - the Part 1 checks: save, replace and remove the SerpApi key; persistence across refresh, navigation, project switch, sign-out/sign-in and a new deployment
   - the screen-by-screen review and screenshots
   - Wewine's project id for the smoke test
   
   Enter the SerpApi key yourself in Settings → Account → API credentials. Claude doesn't type credentials.
2. **Rotate the SE Ranking key** (it was pasted in chat earlier) and update `SERANKING_API_KEY`.
3. **Before any Production release:**
   - set `CREDENTIALS_ENCRYPTION_KEY` for Production
   - run migrations 0004–0007
   - save provider keys under Account settings, or list allowed accounts in `LEGACY_SERVER_CREDENTIAL_ACCOUNTS`. Production review classification currently uses the env `OPENAI_API_KEY`.
4. Earlier items still open: allowlist impact query (`SMOKE-TEST.md` §1), `CRON_SECRET` for Production.
