# Accepted risks and open security notes

## Accepted for this iteration (owner decision, 17 Oct 2026)
| Risk | Status | Notes |
|---|---|---|
| The Production Neon `neondb_owner` connection string, including its password, and the SE Ranking API key were pasted in plain text into the release chat. | **Unresolved; accepted for this iteration.** The owner decided not to rotate them now. | The credentials are unchanged. Neither value appears in any committed file, log or screenshot. The encryption key, the backup branch `pre-v2-pilot-2026-10-17` (which carries the same database password) and the encryption-key recovery copy are kept as they are. Revisit at the next security review. |

## Configuration notes
- **Production database variables also reach Preview deployments.** The Production store `neon-camel-coin` is connected to the seo-console project for the **Production and Preview** environments. Every Preview deployment therefore receives Production's `DATABASE_URL`. The code never uses it on Preview: Preview reads only `PREVIEW_DATABASE_URL` (lib/environment.ts). Still, limiting the connection to Production only would reduce exposure. In Vercel → Storage → `neon-camel-coin` → Projects → seo-console, untick Preview. Nothing in the app depends on it.
- **Feature-branch deployments are disabled** (vercel.json `git.deploymentEnabled`). They failed anyway, because the Preview store `seo-console-preview` has a required Neon deployment action that provisions a database branch per Preview deployment. Validation for feature branches runs in GitHub Actions instead (`.github/workflows/ci.yml`), with no secrets. Only `main` (Production) and `preview` (staging) deploy.
