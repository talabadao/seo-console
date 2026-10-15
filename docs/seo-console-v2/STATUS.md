# STATUS

_Last updated: 2026-10-15 — Milestone 00 (audit) complete on branch `docs/v2-repository-audit`._

## Starting state
- Host `talabadao/seo-console` `main` @ `05f0c1d` = production on seo-console-zoro.vercel.app (verified in Vercel).
- Donor `tin-headsonpillows/ai-brand-mention` @ `5876464` (only branch). Deployment not visible to this audit.
- No automated tests in either repository. Host `lint`, `typecheck` and `build` passed at `05f0c1d` (last run 2026-10-08, before this audit; not re-run because no code changed).
- Separate deployment `seo-console-official` (own repo) at `edb65bb`, diverged from the host.

## Done
- [x] 00 — AUDIT.md, REUSE-MAP.md, ROUTE-MAP.md, MIGRATION-PLAN.md, ROADMAP.md, this file. Blueprint pack copied into `docs/seo-console-v2/`.

## Open questions blocking later milestones (see AUDIT §5)
1. Phase 1 login policy: one shared Google account, or individual company accounts? (blocks 02a)
2. Donor deployment and Blob store location (blocks donor history import in 06/07/08)
3. Future of `seo-console-official`
4. Separate preview database — previews currently use the production database (blocks 02a onward)
5. Indexing API: restrict Submit to eligible pages now or in 09a?
6. Approval to add a test runner (blocks 01a)

## Known issues carried forward
- README describes SQLite; code is Postgres (fix in 01a).
- Secrets stored in plaintext columns (fix in 02b).
- Indexing and Reviews analysis continue only while the browser tab is open (fix in 03).
- Project addresses depend on the project name (fix in 01d).

## Next task
**Milestone 01a — foundations** (`chore/v2-foundations`): README rewrite, test runner, migration-history baseline. Waiting on Q6.
