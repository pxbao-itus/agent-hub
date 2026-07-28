## Khi nào dùng Prompt

Dùng Prompt cho chỉ dẫn dạng text cần được AI client lấy và chạy nhiều lần.
Prompt phù hợp khi giá trị chính nằm ở cách diễn đạt và người gọi có thể truyền
input khác nhau trong mỗi lần sử dụng.

Dùng Skill khi agent cần một quy trình rộng hơn hoặc cần file hỗ trợ.

## Tạo Prompt có thể tái sử dụng

1. Chọn personal space hoặc group owner space.
2. Đặt title theo mục đích và description ngắn.
3. Thêm tag ổn định để người khác dễ tìm.
4. Viết prompt body.
5. Chèn biến bằng hai dấu ngoặc nhọn, ví dụ `{{language}}` hoặc
   `{{source_code}}`, cho giá trị được truyền khi sử dụng.
6. Kiểm tra danh sách biến được nhận diện và lưu.

Nên đặt tên biến có ý nghĩa và không dùng hai tên cho cùng một khái niệm. Hãy mô
tả format input trong body nếu sự mơ hồ có thể làm thay đổi kết quả.

## Duy trì và sử dụng

Mỗi lần lưu chỉnh sửa tạo một version bất biến. Dùng compare để xem thay đổi và
rollback để khôi phục nội dung cũ dưới dạng một version mới.

Trang chi tiết hiển thị định danh MCP và thông tin sử dụng. Agent đã kết nối có
thể tìm Prompt được phép truy cập mà không cần sao chép body vào từng cấu hình
client.

Visibility kiểm soát khả năng tìm thấy; ownership và role kiểm soát chỉnh sửa.
Đặt Prompt trong group space khi group cần cùng duy trì. Chỉ chia sẻ trực tiếp
khi một user ngoài luồng quyền group thực sự cần dùng.

Xem [Phiên bản và lịch sử](/help/versions-and-history) và
[Kết nối AI agent](/help/connect-agent) để biết thêm.
