# Module update, 17 Oct 2026

**Scope:** implements the owner's 2026-10-17 decisions, which supersede the earlier Docs publisher rule and the multi-engine Organic SERP. PR #25, stacked on #24.

**Baselines:** donor `tin-headsonpillows/ai-brand-mention` @ `07e7616`; its SE Ranking and tracking code is unchanged since `5876464`. Host `preview` @ `7f405a1`.

## 1. Donor → host parity
| Donor (src/components/seranking, src/components/tracking) | Host destination | Status |
|---|---|---|
| SeRankingTab: project bar, SE Ranking project link picker | Host project switcher + Project settings → Integrations (one mapping per project) | Replaced by design (no second project store) |
| OverviewSection: headline numbers | Rank tracking → SE Ranking → Overview | Ported. Avg position, Top 10 and movers use the card's scope; visibility, DT and indexed pages come from SE Ranking's summary and are labelled. |
| OverviewSection: "Rankings over time" (visibility / avg position / top 10, 30–180 days, chart/table) | Overview | Ported (per engine, 180-day history) |
| OverviewSection: position spread, biggest gains/drops (7d) | Overview | Ported; adds a "not checked" bucket distinct from "not in top 100" |
| OverviewSection: site audit / AI presence panels | Overview: site audit, competitors and backlinks summaries linking to their modules | Ported. AI presence isn't ported (not part of this module, per the owner). |
| RankingsSection: engine picker, search, filters, sort, 30-day sparkline, 1d/7d/30d, best, volume, URL, SERP features, show more | Rank tracking → SE Ranking → Rankings | Ported onto the host table, which adds date range, comparison, keyword groups, history charts and pagination |
| CompetitorsSection: market vs tracked scope, bubble chart, visibility trend, share, keyword-level top 10, rivals' positions | Competitive research → Competitor overview | Ported (donor component). Top 10 is read for the 40 highest-volume keywords (donor: 100) to fit a 60 s function. |
| BacklinksSection: Data API profile (DT/PT, new/lost, anchors, countries, TLDs, top pages, competitors) + Backlink Monitor | Link Building → Backlinks | Ported (donor component). The profile is manual-only and budgeted, the refresh is disabled with a reason when not allowed, and the free entitlement check is shown. |
| AuditSection: score, issues by section and severity, vitals | Technical SEO → Site audit | Ported (donor component). Reads the latest existing audit and never starts a crawl. |
| AiSection (AI prompts / SE Visible) | — | Not ported (owner: no unrelated donor AI tabs) |
| Generated mock snapshot when no key | — | Not ported. Live mode shows "unconfigured". Demo (.example) projects use the host's labelled demo screens. |
| tracking/TrackingTab (Overview, Rank tracker, Mentions & Citations, AI responses, Settings) | Rank tracking → **Organic SERP** (`/organic-serp/organic/<view>`) | Already ported in #11. Now canonical. AI Area → Google Search Tracking redirects here with the same view. |
| tracking/ProjectBar, credential fields | Host project switcher; Account → API credentials; Settings → Budgets | Replaced by design |

## 2. SE Ranking API entitlements
- **Project API.** Rank tracking, competitors, audits and Backlink Monitor use the Project API, which counts against subscription limits rather than credits. Preview already reads it with the server key: the 16 Oct report and card worked.
- **Data API.** The backlink profile uses the Data API, which costs credits: `/backlinks/summary` is 100, and the donor's full profile is about 750 per refresh. SE Ranking's help center disagrees with itself on whether the same key works for both APIs.
  - The page calls `GET /v1/account/subscription` (0 credits) and reports one of: available (units left), insufficient, no access (401/403/404) or unknown. The result for this account's key is recorded in VERIFICATION.md once read on Preview.
  - Additional access may be needed: a Data API subscription or credits, plus `SERANKING_DATA_CREDITS_MONTH` on Production. Preview never spends credits.

## 3. SerpApi: root causes found so far
1. **Preview allowlist unset (confirmed).** `vercel env ls` (names only) shows no `PREVIEW_SERPAPI_TEST_PROJECT_ID` on Preview, so `lib/providers/policy.ts` refuses every Preview SerpApi request, whatever key is saved.
   - Fix: set it to Wewine's real project id. That id is read from the signed-in app; Vercel doesn't release the sensitive database URL, so it wasn't guessed.
2. **Legacy key precedence (code).** The resolver used a project's legacy key before the account key. A key saved in Account → API credentials was ignored for any project that still had an old project key.
   - Fixed: the order is now account → legacy project → permitted server key.
3. **Misleading enablement (code).** "Run now" was enabled from the account-wide usage policy, which doesn't apply the per-project Preview rule. A run could start, then stop with "switched off".
   - Fixed: a per-project readiness panel shows the reason and remedy before running.
4. **Error categories.** Rate-limit (429), quota, invalid key, timeout and network failures are now classified and shown as the "last request" result.

The bounded Wewine smoke test, with usage before and after, is reported in VERIFICATION.md after sign-in.

## 4. Migrations
None are new in #25. The manual-only flag and peek reads use the existing `report_cache`/`sync_jobs` tables (0008). Multi-engine snapshots stay in `serp_snapshots` (0009) as an archive. Nothing was deleted.

## 5. Icons
- The nine supplied files are in `public/icons/providers/`, byte-identical. SHA-256 is checked against `manifest.json` by a test, and provenance is kept in that manifest.
- `ProviderIcon` is decorative next to visible names, uses a fixed size and contained proportions, and sits on a white badge for dark mode.
- Competitor domain favicons in the ported donor screens still use Google's favicon service, as the AI Area already did. That's unchanged and unrelated to the provider icons.

## 6. Follow-ups kept separate
- The GA4 report templates and saved custom report builder aren't implemented and remain a separate milestone.
