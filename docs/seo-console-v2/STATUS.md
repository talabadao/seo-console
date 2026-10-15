# STATUS

_Last updated: 2026-10-15 (afternoon): allowlist is now five accounts; local design review available; Preview partly configured. Nothing merged or deployed to production; no production migrations run._

## Review the new console now (local, mock data)
- Open http://localhost:3000/portfolio while the dev server runs on this machine.
- It runs from branch `preview` with a git-ignored `.env.development.local` containing `V2_MOCK=1` and `V2_SHELL=1`.
- To restart it later:
  ```powershell
  git checkout preview
  Set-Content .env.development.local "V2_MOCK=1`nV2_SHELL=1"
  npm run dev
  ```
- Data shown:
  - Fixture projects: Example Hotel, Sample Spa, Demo Restaurant Group.
  - Demo screens: invented "Lumen Coast Resort (demo)" data.
  - No database and no sign-in.
- Mock mode needs `next dev`, and refuses to run when `VERCEL_ENV` is set, so it never reaches a deployment.

## Pull requests
| PR | Branch | Base | Content | Checks |
|---|---|---|---|---|
| #2 | `docs/v2-repository-audit` | `main` | Audit, plan, owner decisions, route map, roadmap, this file | Vercel ✓ |
| #3 | `chore/v2-foundations` | `main` | **01a**: README, Vitest + tests, CSV formula fix, migration tooling (not run) | Vercel ✓ |
| #4 | `feat/login-allowlist` | #3 | **Five-account** sign-in allowlist; impact query and smoke test (`SMOKE-TEST.md`) | see below |
| #5 | `chore/preview-isolation` | #3 | Preview-only database; no writes or schedules in Preview; session key fails closed; **"Preview not configured" page instead of a 500**; setup checklist (`PREVIEW-SETUP.md`) | see below |
| #6 | `fix/indexing-eligibility` | #3 | Indexing API only for JobPosting / livestream pages | Vercel ✓ |
| #7 | `feat/v2-shell` | #3 | **01b**: new shell behind `V2_SHELL=1`, demo screens, screenshots | Vercel ✓ |

**Merge order:** #2, then #3. Once #3 is merged, retarget #4–#7 to `main` (`gh pr edit <n> --base main` if GitHub doesn't do it), then re-check each diff and its checks before merging.

**Known overlaps** (resolved on the `preview` branch):
- #4 and #5 both add an import to `lib/session.ts`; keep both.
- #4, #5 and #7 all edit `app/[[...path]]/page.tsx`. Order inside `Home`:
  1. local mock mode
  2. Preview-not-configured check
  3. `currentUser` and the allowlist error on the sign-in page
  4. shell routing

## Sign-in allowlist (#4)
- Exactly these five addresses, one list for Preview and Production (`lib/auth/allowlist.ts`):
  - `analytics@headsonpillows.com`
  - `analytics@artemisdigital.com`
  - `tinledoihoa@gmail.com`
  - `tin@headsonpillows.com`
  - `tin@artemisdigital.com`
- Checked on the server against Google's verified ID token (`email_verified` must be true).
- Whitespace is trimmed and case ignored before comparing. Exact addresses only, never whole domains.
- Each account sees only the projects it owns: users are matched by their own email, and projects by user id. Being on the list grants nothing in another account's projects.

## Deployed Preview
- **Stable URL:** https://seo-console-git-preview-zoro-hoang.vercel.app
  - This is Vercel's automatic branch URL for `preview`, confirmed in the deployment's aliases.
  - `seo-console-preview.vercel.app` was never attached, hence its 404. It shouldn't be added: Deployment Protection is "all except custom domains", so an added domain would be public.
- **Access:** Vercel Authentication stays on. Log in to Vercel as `tinledoihoa@gmail.com` (username `tinledoihoa-6361`, owner of team zoro-hoang; GitHub `talabadao`), the team's only member.
- **Preview variables, branch `preview`:**
  - Set by Claude: `V2_SHELL=1`, `GOOGLE_REDIRECT_URI=https://seo-console-git-preview-zoro-hoang.vercel.app/api/auth/google/callback`
  - Still missing: `PREVIEW_DATABASE_URL`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Verified state** (deployment `seo-console-19udzrs4r-zoro-hoang.vercel.app`, commit 05d8614):
  - The build is READY. That only means the code compiles.
  - The app isn't usable yet: the page shows "Missing Preview settings". `/api/preview-status` reports no database, `externalWrites:false`, `schedules:false` and the missing setting names.
  - The previous build returned a 500 here; that's fixed in #5.
  - Unauthenticated requests get a 302 to Vercel's login, so protection is on.

## Checks (run locally, 2026-10-15)
| Branch | typecheck | lint | tests | build |
|---|---|---|---|---|
| #3 | ✓ | 0 errors / 18 warnings | 47/47 | ✓ |
| #4 | ✓ | 0 / 18 | 52/52 | Vercel |
| #5 | ✓ | 0 / 18 | 56/56 | Vercel |
| #6 | ✓ | 0 / 18 | 55/55 | ✓ |
| #7 | ✓ | 0 / 19 (+1: sidebar collapse state) | 57/57 | ✓ |
| `preview` (all) | ✓ | 0 / 19 | 79/79 | Vercel |

Local mock review in the browser (this round):
- `/portfolio` shows 3 fixture projects
- the project row opens `/p/1/dashboard/overview`
- the sidebar opens Keyword explorer (Demo); expanding Technical SEO shows Structured Data / Schema (Planned)
- the switcher moves to Sample Spa on the same page
- Competitor overview, Backlinks, Editorial board and Monthly report all render with the Demo label
- no horizontal overflow

## Verified facts
- `CRON_SECRET` is not set in any Vercel environment. Both cron routes return 401 without it, so scheduled jobs have not been running. Fix: `PREVIEW-SETUP.md`, last section.
- The installed Neon integration's Free plan allows 100 projects, with no card. A separate Preview database costs nothing.
- `PAGESPEED_API_KEY` is stored as a non-sensitive variable (Vercel flags it "readable-secret"). Optional: re-add it marked Sensitive.
- The repository is **public**. Committed screenshots use fixture data only. The five allowlisted addresses are visible in the code.

## Owner actions needed
1. **Preview setup**, `PREVIEW-SETUP.md` steps A–D:
   - Neon Free database `seo-console-preview`, connected to Preview with prefix `PREVIEW`
   - new Google OAuth client for the branch URL; test users = the five addresses (if the app is in Testing)
   - three Sensitive Preview variables
   - four PowerShell commands for schema and fixtures
2. **Allowlist impact:** run the read-only query in `SMOKE-TEST.md` §1 and send the counts. Don't ship #4 until that's reviewed.
3. **Sign-in smoke test:** `SMOKE-TEST.md` §3 on the Preview with all five accounts plus one refused account.
4. **`CRON_SECRET`** for Production (`PREVIEW-SETUP.md`, last section), then redeploy production.

## Blockers
- A usable deployed Preview, migration tests and live checks of the shell's existing views wait on owner action 1.
- Shipping #4 waits on owner action 2.

## Next smallest task
When owner action 1 is done:
- Claude redeploys `preview` and verifies status, database host and the Google redirect.
- Then the sign-in smoke test.

No new milestone starts before that. After it, **Milestone 01d**: legacy `/<slug>/<tab>` addresses redirect to `/p/<id>/…` when the flag is on.
