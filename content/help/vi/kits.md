## Kit đại diện cho điều gì

Kit gom các artifact liên quan thành một package có thể tái sử dụng. Kit phù hợp
cho workflow, domain hoặc cấu hình agent cần nhiều Prompt và Skill cùng lúc.

Kit có thể chứa Kit lồng nhau. Agent Hub resolve member lồng nhau, ngăn cycle và
lọc nội dung mà user hoặc token hiện tại không có quyền truy cập.

## Tạo Kit

1. Xác định mục đích và user hoặc agent sẽ dùng.
2. Chọn owner space và visibility.
3. Viết overview ngắn mô tả cách các member phối hợp.
4. Tìm và thêm artifact đã có.
5. Sắp xếp member theo thứ tự dễ hiểu.
6. Lưu và kiểm tra danh sách member đã resolve.

Ưu tiên reference tới artifact đang được duy trì thay vì copy nội dung vào
overview của Kit. Mỗi member vẫn có owner, permission và lịch sử version riêng.

## Quyền truy cập và nhân bản

Xem được Kit không đảm bảo xem được mọi member được reference. Kết quả resolve
chỉ chứa member mà identity hiện tại có quyền đọc.

Nhân bản Kit tạo một Kit có ownership độc lập nhưng vẫn reference các member đọc
được. Member bạn không truy cập được có thể bị bỏ qua, vì vậy cần review kết quả
trước khi chia sẻ hoặc sử dụng bản sao.

Dùng CLI sync khi cần đưa Skill và file của Kit vào workspace local. Dùng MCP
khi agent chỉ cần tìm và lấy nội dung.

Xem [Tái sử dụng, import và export](/help/reuse-and-portability) và
[Đồng bộ filesystem bằng CLI](/help/cli-sync).
