# Cách phát triển SEO Console bằng Claude Code và VS Code

## 1. Nên dùng cả Claude Code và VS Code

Claude Code là công cụ AI làm việc với code; VS Code là môi trường để xem file, sửa code, dùng terminal, kiểm tra Git diff và chạy/debug. Bạn không phải chọn bỏ một trong hai. Claude Code có extension chính thức cho VS Code, hỗ trợ xem thay đổi trực tiếp và đưa file vào ngữ cảnh. [Tài liệu chính thức](https://code.claude.com/docs/en/vs-code).

Với dự án này, cấu hình làm việc hợp lý là **VS Code + Claude Code + GitHub PR + preview deployment + database thử nghiệm riêng**. Yếu tố làm quy trình chuyên nghiệp hơn là phạm vi thay đổi rõ, lịch sử quyết định, kiểm chứng và khả năng khôi phục.

20–30 người dùng SEO không có nghĩa cần 20–30 người cùng sửa code. Nên có một người phụ trách sản phẩm, một người chịu trách nhiệm kỹ thuật/merge, và một nhóm 3–5 người dùng thử đại diện. Người mới có thể dùng AI xây từng module; phần auth, migration, job/budget và production rollout nên có người hiểu kỹ thuật review.

## 2. Cấu trúc thư mục đề xuất

Giữ cấu trúc `app/` ở root của host; không cần chuyển cả repo sang `src/` chỉ để giống donor. Đây là hướng tổ chức dần khi sửa module, không phải yêu cầu di chuyển tất cả file trong một PR.

```text
seo-console/
├─ app/
│  ├─ (console)/
│  │  ├─ layout.tsx
│  │  ├─ portfolio/page.tsx
│  │  └─ p/[projectId]/
│  │     ├─ dashboard/page.tsx
│  │     ├─ keyword-research/page.tsx
│  │     ├─ competitive-research/page.tsx
│  │     ├─ link-building/page.tsx
│  │     ├─ organic-serp/
│  │     │  ├─ se-ranking/page.tsx
│  │     │  └─ [engine]/page.tsx
│  │     ├─ search-console/page.tsx
│  │     ├─ analytics/page.tsx
│  │     ├─ local-seo/...
│  │     ├─ technical-seo/...
│  │     ├─ content/page.tsx
│  │     ├─ ai-area/page.tsx
│  │     ├─ automation/page.tsx
│  │     ├─ reports/...
│  │     └─ settings/page.tsx
│  ├─ api/                         # HTTP handlers mỏng, có auth/validation
│  └─ [[...path]]/page.tsx         # Compatibility trong thời gian chuyển đổi
├─ components/
│  ├─ ui/                         # Button, Dialog, Table, Input...
│  ├─ shell/                      # Sidebar, ProjectSwitcher, Breadcrumb...
│  └─ analytics/                  # MetricCard, ChartPanel, ExportMenu...
├─ features/
│  ├─ dashboard/
│  ├─ keyword-research/
│  ├─ competitive-research/
│  ├─ link-building/
│  ├─ se-ranking/
│  ├─ serp-tracking/
│  ├─ search-console/
│  ├─ analytics/
│  ├─ local-seo/
│  ├─ technical-seo/
│  ├─ content/
│  ├─ ai-area/
│  ├─ automation/
│  ├─ reports/
│  ├─ docs/
│  └─ settings/
├─ server/
│  ├─ auth/                       # Session, workspace/project authorization
│  ├─ db/                         # Repositories/query services
│  ├─ integrations/
│  │  ├─ google/                  # GSC, GA4, PSI/CrUX, Workspace
│  │  ├─ seranking/
│  │  ├─ serpapi/
│  │  ├─ searchable/
│  │  ├─ asana/
│  │  ├─ slack/
│  │  └─ registry.ts              # Capability/status; future provider slots
│  ├─ jobs/                       # Scheduling, retries, leases, checkpoints
│  ├─ usage/                      # Reservations, budgets, actual spend
│  └─ secrets/                    # Encryption, rotation, redaction
├─ lib/                           # Giữ helper cũ trong quá trình chuyển đổi
├─ db/migrations/                 # Versioned additive migrations
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ e2e/
├─ fixtures/                      # Dữ liệu giả/response đã che thông tin
├─ scripts/                       # Dry-run import, reconciliation, backfill
├─ docs/seo-console-v2/
│  ├─ 02-product-spec.en.md
│  ├─ 03-ai-coding-prompts.en.md
│  ├─ AUDIT.md
│  ├─ REUSE-MAP.md
│  ├─ ROADMAP.md
│  ├─ STATUS.md
│  ├─ decisions/
│  └─ references/
├─ AGENTS.md
├─ CLAUDE.md
└─ .env.example                   # Tên biến và ví dụ giả, không có secret
```

Một feature có thể chứa `components/`, `types.ts`, `schemas.ts`, `queries.ts`, `demo.ts` và `README.md`. Không tạo đủ mọi thư mục rỗng khi chưa có nhu cầu. Server code phải được bảo vệ khỏi import vào client bundle. `page.tsx` chỉ ghép bố cục và gọi feature; không chứa toàn bộ parser API, SQL và UI.

Không thêm cả DataForSEO, SpySERP, WordPress và AgencyAnalytics SDK ngay từ đầu nếu chưa triển khai. Catalogue và interface có thể mô tả provider tương lai mà không cài thêm dependency.

## 3. Các nhánh GitHub

Đề xuất dùng nhánh tính năng ngắn hạn và PR vào `main`, theo nguyên tắc của [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow). Cách đặt tên dưới đây là đề xuất riêng cho dự án:

```text
main
├─ docs/v2-repository-audit
├─ feat/v2-shell
├─ feat/workspace-connections
├─ feat/sync-jobs-budget
├─ feat/gsc-shell-migration
├─ feat/ga4-report-builder
├─ feat/seranking-core-import
├─ feat/serp-google
├─ feat/local-reviews-import
└─ fix/project-switch-stale-data
```

Các nhánh này không tồn tại vĩnh viễn. Mỗi nhánh là một thay đổi có thể review/merge/rollback, rồi đóng sau khi hoàn tất. Không tạo một nhánh sống lâu tên `ga4` và một nhánh sống lâu tên `se-ranking` rồi nhiều tháng sau mới ghép.

- `main`: trạng thái phát hành được, có branch protection và required checks phù hợp với gói GitHub.
- PR: có preview dùng database/storage thử nghiệm. Không dùng chung production DB chỉ vì UI đang ở preview URL.
- Có thể dùng staging environment cho kiểm thử tổng hợp mà không bắt buộc thêm nhánh `develop` lâu dài. Chỉ thêm nhánh release/integration khi quy trình team thực sự cần.
- Feature chưa hoàn chỉnh đi sau feature flag, để merge phần nền tảng nhỏ mà không lộ workflow dang dở cho team.
- Gắn release tag sau mốc ổn định; lưu bản migration/rollback đi kèm.
- Donor repo giữ nguyên trong thời gian chuyển đổi. Không force push hoặc đổi tên nhánh mặc định đang triển khai chỉ để làm đẹp lịch sử.

Nếu tự làm một luồng, chỉ cần một checkout và một nhánh tại một thời điểm. Nếu sau này bạn chủ động chạy nhiều phiên AI cho các phần độc lập, dùng worktree riêng và chia ranh giới file rõ; tránh hai phiên sửa schema/navigation cùng lúc. Không cần dùng nhiều agent để bắt đầu.

## 4. Một vòng làm việc nên diễn ra thế nào

1. **Chọn một kết quả nhỏ.** Ví dụ: “đưa Performance hiện tại vào shell mới, giữ nguyên số liệu và export”, không giao “làm toàn bộ All in One”.
2. **Viết tiêu chí nghiệm thu.** Route nào, bộ lọc nào, dữ liệu thật hay demo, trạng thái lỗi nào, phần gì giữ nguyên.
3. **Mở nhánh riêng.** Kiểm tra đang ở đúng repository/branch; không đổi nhánh khi còn thay đổi chưa hiểu rõ.
4. **Gửi Master Context + prompt phù hợp.** Cho AI đọc spec, STATUS và file liên quan. Yêu cầu lập danh sách file dự kiến sửa rồi thực hiện.
5. **Xem diff và preview.** Kiểm tra hành vi bằng dự án thử, nhất là đổi project/filter và quay lại bằng Back.
6. **Chạy kiểm chứng đúng phạm vi.** Host hiện có `lint`, `typecheck`, `build`; test mới cần kiểm tra các rủi ro thật như auth, tính số liệu, retry/budget và migration. Không gọi API trả phí chỉ để test giao diện.
7. **PR + review + merge có chủ đích.** Chỉ triển khai production khi mốc đã đủ nghiệm thu; theo dõi pilot trước khi bật hết dự án.
8. **Cập nhật STATUS và quyết định.** Phiên AI sau dựa vào file và code, không phụ thuộc trí nhớ của đoạn chat dài.

Ví dụ yêu cầu sửa UI có hiệu quả:

```text
On the GA4 Landing Pages view, the table becomes difficult to scan at 1280 px.
Keep every current column and all data calculations unchanged.
Use a sticky first column, right-align metrics, reduce row height to the shared
compact setting, and place advanced filters in the existing filter drawer.
Acceptance: no whole-page horizontal overflow, table horizontal scrolling works,
and CSV includes the same columns and values as before. Change only this view
and shared table styles that are necessary; verify other table consumers.
```

“Làm đẹp hơn” không cho AI biết cần bảo vệ điều gì. Một ảnh kèm ba nhận xét cụ thể thường hiệu quả hơn một prompt dài toàn tính từ.

## 5. File hướng dẫn AI và lưu trạng thái

Repo hiện có `CLAUDE.md` tham chiếu `AGENTS.md`, và AGENTS chứa hướng dẫn Next.js được sinh tự động. Giữ các chỉ dẫn đó; thêm quy tắc dự án ngắn ở phần riêng. Claude Code hỗ trợ hướng dẫn cấp dự án qua CLAUDE.md. [Tài liệu memory](https://code.claude.com/docs/en/memory).

Nội dung bổ sung đề xuất:

```text
Project rules:
- Preserve working behavior; implement the current milestone only.
- Read docs/seo-console-v2/STATUS.md before changing code.
- New project data and API access must enforce workspace/project scope.
- Provider clients and secrets are server-only.
- Demo mode is explicit and isolated; never fake live success.
- Background work uses the shared durable job system and budget reservations.
- Preserve source, period, timezone, coverage and metric definitions.
- No unrelated dependency upgrades or destructive migrations.
- Do not merge, deploy production or execute external writes without authorization.
- Report checks actually run and update STATUS.md before handing off.
```

`STATUS.md` chỉ cần khoảng một trang: milestone, nhánh/commit, phần xong, phần còn lại, kiểm tra đã chạy, blocker, quyết định mới, bước kế tiếp. `decisions/` chứa quyết định khó đảo ngược, ví dụ chọn job runner hoặc quy tắc tổng hợp KPI; mỗi file có bối cảnh, lựa chọn, lý do và hệ quả.

Prompt không nên chứa API key. Cài key qua environment hoặc Settings đã có backend bảo vệ. Các file response mẫu phải xóa token, email cá nhân, query string chứa key và dữ liệu khách hàng không cần thiết.

## 6. PR và checklist tối thiểu

Một PR nhỏ có thể dùng mẫu:

```text
Problem and resulting behavior:
[Who experienced what problem, and what now works differently?]

Scope:
[Affected module and any data/schema/provider changes.]

Validation:
[Commands actually run; fixtures or isolated environment; UI screenshots.]

Rollout / rollback:
[Feature flag, additive migration, legacy compatibility, known limitations.]
```

Review kỹ hơn với thay đổi auth, secret, job scheduler, budgets, SQL migration và publish workflow. Với sửa khoảng cách/màu đơn giản, kiểm tra trực quan và các consumer liên quan là đủ; không cần dựng test chỉ để khẳng định một class CSS.

Không chấp nhận “đã hoàn thành” nếu chỉ chạy được trang mặc định. Hãy thử thêm: project chưa kết nối, API hết quota, tập dữ liệu rỗng, đổi project khi đang tải, hai lần bấm Sync, và dữ liệu đã cũ. Đây là những tình huống rất thường gặp với 65–80 dự án.

## 7. Việc nên làm đầu tiên

Chạy **Prompt 00** với cả hai repository. Chốt repo/commit đang deploy, sơ đồ project mapping và kế hoạch nhập donor. Tiếp theo làm shell có demo để bạn xem thiết kế, rồi triển khai workspace/connections và jobs/budget trước khi bật tích hợp ở quy mô agency. Không cần quyết định ngay toàn bộ tính năng giai đoạn 2.
