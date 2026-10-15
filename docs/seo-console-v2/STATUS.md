# STATUS

_Last updated: 2026-10-15 (evening). Dashboards redesigned (#8); Preview database connected and verified empty; three Preview variables still missing. Nothing merged or deployed to production; no production migrations run._

## Review the console now (local, mock data)
- Open http://localhost:3000/portfolio while the dev server runs on this machine.
- It runs from branch `preview` with a git-ignored `.env.development.local` containing `V2_MOCK=1` and `V2_SHELL=1`.
- To restart it:
  ```powershell
  git checkout preview
  Set-Content .env.development.local "V2_MOCK=1`nV2_SHELL=1"
  npm run dev
  ```
- **Data:** 30 invented projects, every number labelled Demo. Some fixtures show the not connected, stale and error states. No database, no sign-in.
- **Safety:** mock mode can't run on any Vercel deployment.

## Pull requests
| PR | Branch | Base | Content | Vercel |
|---|---|---|---|---|
| #2 | `docs/v2-repository-audit` | `main` | Audit, plan, decisions, route map, roadmap, this file | ✓ |
| #3 | `chore/v2-foundations` | `main` | **01a** foundations, Vitest, migration tooling (not run) | ✓ |
| #4 | `feat/login-allowlist` | #3 | Five-account sign-in allowlist; impact query; smoke test | ✓ |
| #5 | `chore/preview-isolation` | #3 | Preview-only database (also accepts the Neon integration's `PREVIEW_DATABASE_URL_DATABASE_URL`); session key fails closed; "Preview not configured" page; read-only database readiness in `/api/preview-status`; demo projects for the signed-in user; `migrate:preview` / `seed:preview` read the git-ignored `.env.preview-migrate`; setup checklist | ✓ |
| #6 | `fix/indexing-eligibility` | #3 | Indexing API only for JobPosting / livestream pages | ✓ |
| #7 | `feat/v2-shell` | #3 | **01b** shell behind `V2_SHELL=1` | ✓ |
| #8 | `feat/v2-dashboards` | #7 | **01e** project dashboard, All projects performance table, Project settings sections, summary adapters (`DASHBOARDS.md`) | ✓ |

**Merge order:**
1. #2, then #3.
2. Retarget #4–#7 to `main`, re-check each diff and its checks, then merge.
3. Retarget #8 to `main` after #7.

**Overlaps** (resolved on `preview`):
- `lib/session.ts` (#4 + #5)
- `app/[[...path]]/page.tsx` (#4 + #5 + #7). Order inside `Home`:
  1. mock mode
  2. Preview-not-configured check
  3. `currentUser` and the allowlist error on the sign-in page
  4. shell routing

## Deployed Preview: https://seo-console-git-preview-zoro-hoang.vercel.app
Vercel login as `tinledoihoa@gmail.com` (team zoro-hoang owner) first; protection stays on.

| Check | Result |
|---|---|
| Build (commit 2982941) | ✅ READY |
| Database target | ✅ `ep-spring-firefly-b7804i0v-pooler.c-13.us-east-1.aws.neon.tech/neondb`, the Neon store connected to Preview only |
| Database readiness | ✅ reachable; empty (no schema, no migrations). Production has a schema, so this isn't production |
| `V2_SHELL=1`, `GOOGLE_REDIRECT_URI` (branch `preview`) | ✅ set |
| External writes / schedules | ✅ off / off |
| `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Preview) | ❌ missing |
| Usable app | ❌ shows "Missing Preview settings" |
| Real sign-in | not tested |

## Sign-in allowlist (#4)
- **List:** exactly five addresses, the same for Preview and Production:
  - `analytics@headsonpillows.com`
  - `analytics@artemisdigital.com`
  - `tinledoihoa@gmail.com`
  - `tin@headsonpillows.com`
  - `tin@artemisdigital.com`
- **Matching:** Google's verified ID token; whitespace trimmed and case ignored; exact addresses, never domains.
- **Ownership:** each account sees only its own projects.
- **Google's own check:** the OAuth consent screen's test-user list is a separate gate (`PREVIEW-SETUP.md` step 3).

## Dashboards (#8)
- **Project dashboard:**
  - Search Console performance with trend
  - GA4 organic traffic (revenue only in its own currency)
  - monthly KPIs vs target with the status rule shown
  - Asana work, counting completions by completion date
  - content progress (demo)
  - needs attention, built only from real data
- **All projects:** a compact performance table with optional columns.
  - Summaries load for the visible page only, 3 at a time, with caching.
  - Cards count projects and never add metrics across them.
- **Project settings:** General, Integrations (the connection list moved here), KPI targets, Tracking, Budgets and limits, Sync and history.
- **Shell:**
  - readable sidebar labels
  - no milestone numbers in the UI
  - the Settings section is kept when switching projects
- **"1 Issue" badge** in the review screenshots: a momentary merge-conflict parse error while the dev server ran during a merge. It's gone after a reload; no issues are reported on any page.

## Checks (2026-10-15)
| Branch | typecheck | lint | tests | build |
|---|---|---|---|---|
| #4 | ✓ | 0 errors / 18 warnings | 52/52 | Vercel ✓ |
| #5 | ✓ | 0 / 18 | 59/59 | Vercel ✓ |
| #8 | ✓ | 0 / 18 | 73/73 | Vercel ✓ |
| `preview` (all) | ✓ | 0 / 18 | 98/98 | Vercel ✓ |

Browser checks in local mock mode:
- All projects lazy loading and paging
- project dashboard
- settings sections and KPI form
- project switching keeps the page and the settings section
- stale and error states
- no page-level horizontal scroll at 375, 1024 and 1440
- screenshots in `screenshots/01e/`

## Owner actions needed
1. **Preview** (`PREVIEW-SETUP.md`, "Remaining steps"):
   - rotate the exposed Preview database password and confirm Vercel updated it
   - add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and a new `SESSION_SECRET` as Preview variables, branch `preview`, Sensitive
   - confirm the OAuth test users are the five addresses, if the app is in Testing
2. **Schema:** put the rotated connection string in `.env.preview-migrate` so Claude can run and verify the migrations, or let the app create the schema on first sign-in.
3. **Allowlist impact:** run the read-only query in `SMOKE-TEST.md` §1. Don't ship #4 before that.
4. **Sign-in smoke test:** `SMOKE-TEST.md` §3 on the Preview.
5. **`CRON_SECRET`** for Production, then redeploy production.
6. **Optional hardening:** untick Preview on the production Neon store's variables, so PR previews without #5 can't reach production.

## Next
After owner action 1, Claude redeploys `preview` and reports build, database and sign-in separately. Then come the live dashboard numbers on the Preview, and Milestone 01d (legacy-address redirects). No new milestone starts before the Preview is verified.
