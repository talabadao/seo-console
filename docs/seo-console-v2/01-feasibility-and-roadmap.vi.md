# Đề xuất SEO Console All in One

**Kết luận:** khả thi và đáng làm nếu định vị SEO Console là **nơi team xem dữ liệu, quyết định việc cần làm, thực hiện và báo cáo trên cùng một dự án**. Giá trị lớn nhất không nằm ở số lượng menu mà ở việc giảm thao tác qua lại và nối dữ liệu với công việc.

Quy mô 20–30 người, 65–80 dự án khiến quản lý dữ liệu, lịch đồng bộ, quyền truy cập và chi phí quan trọng ngang với giao diện. Giai đoạn 1 nên có đầy đủ bộ khung sản phẩm, nhưng mức độ hoàn thiện từng module khác nhau và phải được hiển thị minh bạch.

## 1. Những gì đã có: hai ứng dụng bổ sung cho nhau

Đánh giá dưới đây dựa trên kiểm tra có mục tiêu ở code, chưa phải kiểm thử production hay audit toàn bộ.

| Nguồn | Bằng chứng đã đọc | Cách sử dụng |
|---|---|---|
| SEO Console | `main`, commit `05f0c1dc70cd92193d4d30e80fe315efad50c551`; Next.js 16.3.4, React 19.2.8, TypeScript, Tailwind 4, Recharts, Postgres, iron-session | Dùng làm ứng dụng chính; giữ GSC, GA4, Weekly Report, project mapping, đăng nhập và Postgres |
| AI Brand Mention | nhánh mặc định lúc kiểm tra `claude/fervent-lovelace-wror83`, commit `5876464af458f1447eb3049f3c5745d8e32127e6`; Next.js 16.3.5, React 19.2.8 | Nguồn tái sử dụng SE Ranking, Google tracking, reviews, bảng AI, một phần content |
| Lưu trữ ứng dụng thứ hai | JSON trong private Vercel Blob; local fallback khi phát triển | Giữ Blob cho ảnh/file lớn; chuyển dữ liệu vận hành và quan hệ dự án sang Postgres khi nhập vào Console |
| Tích hợp Searchable | Chưa tìm thấy adapter Searchable trong code đã kiểm tra; `SearchableSelect` ở Console là component tìm kiếm lựa chọn | Cần xây connector mới; không nhầm tên component với tích hợp SaaS |

Nguồn: [SEO Console package](https://github.com/talabadao/seo-console/blob/05f0c1dc70cd92193d4d30e80fe315efad50c551/package.json), [database](https://github.com/talabadao/seo-console/blob/05f0c1dc70cd92193d4d30e80fe315efad50c551/lib/db.ts), [AI Brand Mention package](https://github.com/tin-headsonpillows/ai-brand-mention/blob/5876464af458f1447eb3049f3c5745d8e32127e6/package.json), [Blob storage](https://github.com/tin-headsonpillows/ai-brand-mention/blob/5876464af458f1447eb3049f3c5745d8e32127e6/src/lib/blobJson.ts).

**Không cần viết lại từ đầu.** Tuy nhiên, không nên merge nguyên hai repository bằng cách ghép mọi file. Hai bên có project ID, persistence, OAuth và giả định bảo vệ truy cập khác nhau. Nên nhập từng module qua lớp chuyển đổi, rồi dùng chung project, session, settings và job queue của Console.

Các điểm đáng xử lý trước khi mở rộng:

- README Console còn mô tả SQLite, nhưng code hiện tại đã dùng Postgres. Quyết định kiến trúc phải theo code và deployment thực tế.
- Console có các component lớn: Indexing 1.230 dòng, Reviews 1.069, Analytics 1.059, WeeklyReport 954, Dashboard 741. Tách theo tính năng khi sửa từng module; tránh đợt đổi cấu trúc toàn repo cùng lúc với đổi giao diện.
- SE Ranking ở ứng dụng thứ hai có rate limiter trong bộ nhớ một tiến trình. Với nhiều Vercel instances và nhiều người bấm Sync, cần giới hạn chung theo credential/account.
- Endpoint sync SE Ranking của ứng dụng thứ hai cho phép request không có Authorization header, dựa vào giả định deployment đã được bảo vệ. Khi nhập vào Console, bắt buộc thay bằng kiểm tra session/quyền dự án; chưa xác minh bảo vệ deployment hiện tại.
- Một số module ứng dụng thứ hai tự sinh mock khi thiếu API key. Bản hợp nhất cần tách **Demo** và **Chưa kết nối**: không dùng dữ liệu giả để che lỗi dữ liệu thật.
- Cron SE Ranking có giới hạn thời gian toàn đợt 240 giây và có thể bỏ qua dự án khi hết thời gian. 65–80 dự án cần queue bền vững và tiếp tục từ checkpoint.

Nguồn: [SE Ranking client](https://github.com/tin-headsonpillows/ai-brand-mention/blob/5876464af458f1447eb3049f3c5745d8e32127e6/src/lib/seranking/client.ts), [sync route](https://github.com/tin-headsonpillows/ai-brand-mention/blob/5876464af458f1447eb3049f3c5745d8e32127e6/src/app/api/seranking/sync/route.ts).

## 2. Định hướng sản phẩm nên chốt

Một luồng sử dụng có giá trị:

**Phát hiện vấn đề → xem bằng chứng → tạo việc trong Asana → theo dõi xử lý → ghi nhận kết quả trong báo cáo.**

Ví dụ: GSC cho thấy một landing page giảm clicks → xem truy vấn và ranking liên quan → tạo task cập nhật nội dung, kèm link và snapshot → khi hoàn thành, task xuất hiện trong Weekly Report → theo dõi kết quả các tuần sau. Không khẳng định thay đổi task là nguyên nhân gây tăng traffic chỉ từ hai mốc thời gian.

Chốt ba đối tượng dùng chung:

1. **Workspace:** công ty, thành viên, credential chung, ngân sách tổng.
2. **Project:** thương hiệu/site/market, KPI, mapping GSC/GA4/SE Ranking/Searchable/Asana, tracking và ngân sách dự án.
3. **Evidence:** snapshot có nguồn, thời gian, phạm vi lọc; được liên kết với task, nội dung và báo cáo.

Một project không nhất thiết chỉ có một domain hay một GSC property. Dự án đa thị trường hoặc nhiều khách sạn cần mapping rõ từng property, location, engine và market; hỗ trợ nhiều mapping trong schema nhưng giữ form giai đoạn đầu đơn giản.

## 3. Phạm vi giai đoạn 1

Mọi mục người dùng yêu cầu đều có vị trí trong sidebar. Nhãn trạng thái cho biết phần nào thật, demo, chưa kết nối hoặc bị giới hạn bởi gói dịch vụ.

| Module | Đề xuất giai đoạn 1 | Giá trị/điều kiện |
|---|---|---|
| Dashboard | Project dashboard + portfolio cho toàn bộ dự án đang được phép xem | KPI, task tháng, overdue, hoàn thành, cảnh báo dữ liệu và ngân sách; portfolio dùng dữ liệu tổng hợp đã lưu |
| Keyword Research | Demo tương tác | Explorer, clusters, saved keywords; chuẩn bị adapter DataForSEO |
| Competitive Research | Demo tương tác | Domain overview, content gap, trang nổi bật; hiển thị ước tính là ước tính |
| Link Building | Demo tương tác | Backlink analytics/gap, prospect list; chưa gửi outreach |
| SE Ranking | Tái sử dụng và sửa để chạy ổn định | Đủ Overview, Rankings, Competitors, Backlinks, Site audit, AI prompts; từng tab phụ thuộc entitlement |
| Google/Bing/Yandex/Naver Tracking | SerpApi, triển khai Google trước rồi từng engine | Kiểm tra tức thời, snapshot, lịch chạy cho tập được chọn; không nhân bản toàn bộ tracking hiện có |
| GSC | Giữ tính năng, đổi shell và chuẩn hóa export | Performance, Opportunities và các bộ lọc đang có |
| GA4 | Giữ nền tảng, bổ sung report builder có giới hạn | Template Organic, Acquisition, Landing pages, Key events, AI referrals |
| Local SEO | Nhập phần reviews tốt nhất từ ứng dụng thứ hai; GBP public profile analysis | Maps + Tripadvisor, competitor comparisons, sentiment có bằng chứng |
| Technical SEO | Giữ Indexing/PSI; bổ sung audit có giới hạn | Crawl theo batch, kiểm tra cấu trúc và thay đổi; không crawl sâu mọi URL mỗi ngày |
| Content | Demo theo yêu cầu, có editor và quy trình duyệt | Có code Articles/Docs/WordPress để tham khảo nhưng chưa bật tự đăng |
| AI Area | Searchable là nguồn chính; tái sử dụng presentation từ app thứ hai | Overview, Prompts, Mentions, Citations, Competitors, Sentiment; không đổi nguồn số liệu âm thầm |
| Automation | Trang quản lý automation + kết nối quy trình GBP hiện có sau kiểm tra | Hiển thị lịch, lần chạy, lỗi, retry; chưa dựng lại posting khi chưa biết Apps Script đang dùng |
| Report | Weekly thật; Monthly demo | Weekly giữ Asana hiện tại; Monthly template chuẩn bị nhiều nguồn |
| Docs | Trang nội bộ thật với tài liệu mẫu có nhãn | Hướng dẫn công cụ, SOP, intern training; Drive links trước, đồng bộ sâu sau |
| Settings | Làm thật từ sớm | Project mapping, credential, model, lịch, budget, audit trail và connection health |

Tách **Top-level Link Building demo** khỏi **Backlinks trong SE Ranking có thể là dữ liệu thật**. Tương tự, **Technical SEO Site Audit nội bộ** và **SE Ranking Site audit** phải có nhãn nguồn riêng để tránh tưởng là cùng một bộ kiểm tra.

## 4. Các giới hạn API cần phản ánh đúng

**SE Ranking:** có Project API cho dữ liệu/tác vụ dự án và Data API cho dữ liệu nghiên cứu. Cùng credential có thể truy cập các bề mặt khác nhau tùy gói; không suy ra có rank tracking là đã có mọi quyền backlinks/AI. Đọc dữ liệu đã tracking khác với khởi tạo kiểm tra mới. Ưu tiên đồng bộ tăng dần, tách backlink refresh ra lịch riêng. [Tài liệu Project API](https://seranking.com/api/project/getting-started/), [AI Results Tracker](https://seranking.com/api/project/ai-result-tracker/).

**SerpApi:** có API Google/Bing/Yandex/Naver nhưng tham số và loại kết quả không hoàn toàn giống nhau. Thiết kế form theo capability từng engine. Giao diện có thể mô phỏng cấu trúc SERP từ JSON; cần gọi là **SERP snapshot**, không hứa giống kết quả Google cá nhân hóa hoặc đúng từng pixel. Độ sâu, phân trang và các khối AI có thể cần thêm request. [Google](https://serpapi.com/search-api), [Bing](https://serpapi.com/bing-search-api), [Yandex](https://serpapi.com/yandex-search-api), [Naver](https://serpapi.com/naver-search-api).

**Google Business Profile:** SerpApi cung cấp thông tin công khai của listing; không thay quyền quản trị GBP, không mặc nhiên đọc được performance riêng, chỉnh sửa profile, đăng bài hoặc trả lời review. Điểm “SEO profile” nếu có là checklist nội bộ có công thức, không phải điểm Google cấp. [Maps Place](https://serpapi.com/maps-place-results).

**Reviews:** API Maps và Tripadvisor có thể cung cấp review để phân tích; phân trang, số lượng lấy được và lịch sử phải được ghi rõ. Sentiment do AI/heuristic suy ra cần gắn phương pháp, mẫu phân tích và trích dẫn review; rating sao là chỉ số khác. [Maps Reviews](https://serpapi.com/google-maps-reviews-api), [Tripadvisor Reviews](https://serpapi.com/tripadvisor-reviews-api).

**GSC/Indexing:** URL Inspection trả trạng thái phiên bản Google đã biết, không phải live test; quota công bố là 2.000 URL/ngày/property. Google Indexing API chỉ dành cho các loại trang được hỗ trợ như JobPosting và BroadcastEvent trong VideoObject; không làm nút “index mọi bài viết”. IndexNow là luồng riêng cho công cụ tìm kiếm tham gia, không phải gửi index cho Google. [Inspection](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect), [quota](https://developers.google.com/webmaster-tools/limits), [Indexing API](https://developers.google.com/search/apis/indexing-api/v3/using-api), [IndexNow](https://www.indexnow.org/documentation).

**GA4:** Data API đáp ứng nhiều báo cáo nhưng không phải toàn bộ giao diện GA4. Cần danh sách metric/dimension hợp lệ, kiểm tra tương thích, scope session/user/event, timezone, attribution và dữ liệu bị threshold. Không cộng daily users thành monthly unique users. Funnel/path/raw events phải được đánh giá riêng. [Core reports](https://developers.google.com/analytics/devguides/reporting/data/v1/basics), [compatibility](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/checkCompatibility).

**PageSpeed:** lab Lighthouse và field CrUX phải tách biệt. Field data thường là cửa sổ 28 ngày và có thể thiếu. Google có thông báo dự kiến ngừng đưa field data vào PSI API, nên thiết kế field adapter riêng dùng CrUX API/History khi cần. [PSI API](https://developers.google.com/speed/docs/insights/v5/get-started), [cách đọc PSI](https://developers.google.com/speed/docs/insights/v5/about).

**llms.txt và cannibalization:** nên kiểm tra llms.txt ở mức thông tin, không coi thiếu file là lỗi SEO nghiêm trọng hay yếu tố xếp hạng đã được chứng minh. Google không yêu cầu tối ưu kỹ thuật đặc biệt để xuất hiện trong AI features. Cannibalization là tín hiệu cần xem xét từ query–page/intent, không kết luận chỉ vì hai trang cùng chứa từ khóa. [Google AI features](https://developers.google.com/search/docs/appearance/ai-features).

**Searchable:** tài liệu chính thức có API và quyền theo scope/gói. Cần kiểm chứng endpoint, lịch sử và fields thực nhận trước khi hứa “đồng bộ toàn bộ”. Có khác biệt giữa mention cả lịch sử và mention trong cửa sổ báo cáo; cần giữ đúng định nghĩa. [API documentation](https://docs.searchable.com/advanced/api-usage).

**AI phase 2:** DataForSEO có nhiều bề mặt như phản hồi LLM, dữ liệu scrape và cơ sở dữ liệu mentions. Phải giữ nhãn nguồn/methodology; gọi API model trực tiếp không tự chứng minh được vị trí thương hiệu trong giao diện ChatGPT của người dùng. [AI Optimization API](https://docs.dataforseo.com/v3/ai_optimization-overview/).

**AgencyAnalytics/SpySERP:** có bề mặt API công khai, nhưng chưa kiểm chứng schema đầy đủ hoặc quyền tài khoản của bạn. Không coi AgencyAnalytics là nguồn có thể xuất toàn bộ dữ liệu của mọi integration. Giữ GSC/GA4 làm nguồn trực tiếp, tránh cộng hai lần cùng số liệu qua AgencyAnalytics. [AgencyAnalytics API](https://agencyanalytics.com/features/agencyanalytics-api), [SpySERP](https://spyserp.com/api/).

## 5. Giao diện: học cấu trúc từ ảnh, giữ bản sắc SEO Console

Các ảnh SEO Utils hữu ích ở sidebar phân nhóm, breadcrumb, bộ lọc sát tiêu đề, bảng dữ liệu dày vừa phải và khả năng drill-down. Không cần sao chép logo, wallpaper hoặc các chỉ số chưa có dữ liệu.

- Sidebar khoảng 248–264 px, thu gọn được; Settings/Docs ở cuối; tìm kiếm nhanh và project switcher ở đầu.
- Top bar hiển thị Workspace → All projects hoặc project cụ thể. Ngày, comparison, market/device, nguồn và lần cập nhật gần nhất dễ nhìn.
- Trang phân tích: title/actions → filter bar → 4–6 KPI → chart → bảng có search/sort/filter/pagination/column visibility → detail drawer.
- Dashboard dự án ưu tiên “việc cần làm”, KPI tháng và vấn đề có thể xử lý. Portfolio ưu tiên dự án lệch KPI, overdue, tracking lỗi, budget gần hết.
- Có chế độ dense/comfortable; số căn phải; màu nhất quán: clicks xanh, impressions tím; màu tăng/giảm phụ thuộc ý nghĩa chỉ số.
- Export card/section/full report sang PNG, copy clipboard và CSV; ảnh phải có project, ngày, filter, nguồn và watermark nếu là demo.
- Demo là dữ liệu ổn định và thao tác thực được trên fixture: lọc, sort, mở chi tiết, lưu view. Không phải trang có các nút không phản hồi.

Không cần dựng “GA4 thu nhỏ” với mọi menu. Một builder tốt cho 5–8 nhu cầu team dùng hằng tuần có giá trị hơn giao diện rộng nhưng metric sai.

## 6. Quy mô, lịch chạy và ngân sách

Khoảng tổng từ khóa theo hai biên người dùng cung cấp là **1.300–24.000**. Đây là biên toán học, không phải số đang tracking thực tế.

Với một lần kiểm tra/ngày, một engine, một market, một device và giả sử một request/check:

| Kịch bản | Checks/tháng 30 ngày |
|---|---:|
| 65 dự án × 20 từ khóa | 39.000 |
| 75 dự án × 100 từ khóa | 225.000 |
| 80 dự án × 300 từ khóa | 720.000 |
| Kịch bản giữa × 2 devices × 4 engines | 1.800.000 |

Đây **không phải bảng giá**, cũng không phải số request SE Ranking cần để đọc dữ liệu đã có. Pagination, độ sâu và tính năng bổ sung có thể làm request cao hơn. Các tổ hợp engine/market không hợp lệ phải bị loại, không nhân máy móc.

Công thức lập ngân sách:

`SERP requests ≈ tổng các tracking context đang bật × số lần chạy × request cần cho độ sâu/khối kết quả + review pages + refresh thủ công`

`LLM cost ≈ token input/output theo model + công cụ tìm kiếm theo nhà cung cấp + phân loại/tóm tắt lại`

`Tổng vận hành = API subscriptions/usage + hosting + Postgres + queue/worker + Blob + logging + backup`

**Khuyến nghị mặc định:** SE Ranking sync hằng ngày; SerpApi on-demand hoặc tập ưu tiên; backlinks hằng tuần; reviews incremental hằng ngày/hằng tuần theo dự án; Searchable daily incremental; audit nhẹ hằng ngày và full crawl hằng tuần; PSI mỗi ngày cho trang đại diện/quan trọng. Đây là lịch đề xuất, cần điều chỉnh theo quota và tính chất khách hàng.

Chạy pilot 3–5 dự án trong khoảng 7 ngày, đo request thực tế, thời gian job, retries, storage và usage rồi mới bật dần 10 → 30 → 80 dự án. Phân tán thời điểm chạy theo timezone dự án; không đồng loạt fan-out lúc 00:00.

Budget cần có cả workspace, project, provider và credential. Nhiều dự án dùng một key thì cùng chia quota. Trước khi gọi API phải giữ chỗ ngân sách trong transaction; sau đó đối chiếu usage thực tế. Rate limit và khóa chạy phải dùng storage chung, không chỉ biến JavaScript trong một instance.

## 7. Tài khoản và phân quyền

Theo yêu cầu, có thể giữ email chung để chuyển tiếp giai đoạn 1. Nhưng mọi log hành động khi đó chỉ quy về cùng một danh tính; không thể biết chắc nhân viên nào làm gì. Với 20–30 người, mình đề xuất **email cá nhân công ty cùng quyền** sớm hơn, rồi mới thêm role nhân viên/quản lý ở giai đoạn 2.

Tách **đăng nhập vào Console** và **kết nối nguồn Google của công ty**. Người dùng Console không cần mỗi người tự kết nối lại GSC/GA4 nếu workspace được phép chia sẻ connector. Không suy ra dùng chung credential là được xem mọi project: vẫn kiểm tra membership phía server.

Schema nên có workspace/membership/project access từ đầu, dù ban đầu chỉ có một member admin. Phase 2 bổ sung role và project assignment; portfolio chỉ là một cách xem, không phải cơ chế bảo mật. Secret không trả lại trình duyệt, không để trong repo/log/URL hay localStorage.

## 8. Lộ trình thực tế

**1A — Hợp nhất nền tảng và giao diện:** audit hai repo, xác định deployment thật, baseline, project identity, design tokens, sidebar, demo routes, preserve legacy views, secret storage và job foundation.

**1B — Dùng được trong công việc hằng ngày:** GSC, GA4 builder giới hạn, Weekly Report/Asana, SE Ranking, Local Reviews, portfolio và project dashboard. Searchable connector được làm khi có credential và payload mẫu đã che thông tin nhạy cảm.

**1C — Mở rộng tracking và technical:** Google rồi Bing/Yandex/Naver, audit giới hạn, PSI/Indexing cải thiện, automation control page. Hoàn thiện demo Content/Research/Monthly và Docs.

**2 — Tăng tự động hóa:** role/assignment đầy đủ, DataForSEO research và AI tracking, SpySERP adapter nếu cần, content approvals/Docs/WordPress thật, automation nâng cao. Thay provider phải giữ lịch sử và ghi mốc đổi phương pháp.

Ước lượng quản trị: một lập trình viên có kinh nghiệm dùng AI, có người SEO phản hồi thường xuyên, có thể cần khoảng **2–4 tuần cho nền tảng và pilot**, và **12–20+ tuần cho phạm vi live rộng của giai đoạn 1** ở quy mô này. Đây là giả định lập kế hoạch, không suy ra từ benchmark; chỉ chốt sau audit deployment, quyền API và tốc độ hoàn thành vài PR đầu. Nếu chỉ vibe code ngoài giờ, hãy quản lý bằng milestone nghiệm thu thay vì hứa ngày ra mắt.

Nên đo hiệu quả sau rollout bằng thời gian làm weekly report, số thao tác chuyển công cụ, % dự án có dữ liệu đúng hạn, số job lỗi được xử lý, chi phí/dự án và tỷ lệ team dùng hằng tuần. Không dùng tổng số menu làm thước đo thành công.
