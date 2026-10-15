# SEO Console — Blueprint & AI Coding Pack

Ngày nghiên cứu: **15/10/2026**. Quy mô đã xác nhận: **20–30 người, 65–80 dự án, 20–300 từ khóa/dự án**.

Bộ tài liệu này phục vụ tư vấn và giao việc cho AI Code. Chưa sửa, merge hoặc triển khai hai ứng dụng.

## Đọc theo thứ tự

1. **01-feasibility-and-roadmap.vi.md** — đánh giá hai repository, khả thi, ưu tiên, quy mô và chi phí vận hành.
2. **02-product-spec.en.md** — đặc tả sản phẩm, giao diện, dữ liệu, kiến trúc và tiêu chí nghiệm thu bằng tiếng Anh.
3. **03-ai-coding-prompts.en.md** — master prompt, prompt kiểm tra ban đầu và prompt triển khai từng phần.
4. **04-vibe-coding-workflow.vi.md** — cách dùng Claude Code cùng VS Code, tổ chức thư mục, nhánh và PR.
5. **05-research-sources.md** — nguồn chính thức, bằng chứng từ code và những điểm chưa kiểm chứng.
6. **references/** — 10 ảnh nguyên bản người dùng cung cấp, được đổi tên theo số thứ tự; README giải thích cách tham khảo.

## Bắt đầu với Claude Code

- Mở repository **talabadao/seo-console** trong VS Code.
- Đặt bộ tài liệu này vào `docs/seo-console-v2/` trong repository khi bắt đầu dự án. Không cần đưa các bản clone nghiên cứu vào repo.
- Mở thêm repository **tin-headsonpillows/ai-brand-mention** ở thư mục bên cạnh để AI đọc và chọn phần tái sử dụng; không chép nguyên ứng dụng đó vào ứng dụng chính.
- Gửi **Master Context + Prompt 00** trong file 03. Prompt 00 chỉ kiểm tra và lập kế hoạch, chưa sửa code sản phẩm.
- Sau đó chạy **mỗi lần một prompt triển khai**. Với các prompt lớn, AI phải tách thành PR nhỏ và chỉ làm phần đang được giao.
- Khi mở cuộc trò chuyện mới, gửi lại Master Context và yêu cầu đọc `docs/seo-console-v2/STATUS.md` do AI cập nhật sau mỗi mốc.

## Giả định đề xuất, không phải yêu cầu mới đã được chốt

- Giữ SEO Console làm ứng dụng chính; nhập chọn lọc module từ AI Brand Mention.
- Giai đoạn 1 có đủ điều hướng; một số module là demo được gắn nhãn rõ ràng.
- Giữ đăng nhập chung trong giai đoạn chuyển tiếp theo yêu cầu. Với 20–30 người, khuyến nghị sớm chuyển sang email cá nhân công ty, ban đầu vẫn cùng quyền; phân quyền nhân viên/quản lý ở giai đoạn 2.
- SE Ranking là nguồn ranking định kỳ chính; SerpApi phục vụ kiểm tra SERP và những tập từ khóa được chọn, không mặc định chạy lại toàn bộ từ khóa trên cả bốn công cụ tìm kiếm.
- Các ước lượng thời gian và ngân sách trong tài liệu là giả định lập kế hoạch, không phải báo giá hoặc cam kết.

## Phạm vi kiểm chứng

Đã đọc code cục bộ của hai repository công khai và tài liệu API chính thức. Chưa đăng nhập kiểm thử website, chưa gọi API trả phí bằng tài khoản của bạn, chưa xác minh dữ liệu production hoặc gói thuê bao. Website không đọc được qua công cụ web; kết nối đọc Sheet GBP Post Auto bị lỗi, nên cấu trúc Sheet và Apps Script chưa được kiểm tra. Xem file 05 để biết chi tiết.
