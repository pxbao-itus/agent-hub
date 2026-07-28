## Khi nào dùng Doc

Doc là tài liệu tham chiếu có version, ví dụ specification, decision,
investigation, runbook hoặc ngữ cảnh khác mà người dùng và agent cần. Dùng Plan
khi mục đích chính là theo dõi task.

## Tạo và tổ chức Doc

1. Chọn owner space và visibility.
2. Viết title rõ ràng và description ngắn.
3. Cấu trúc Markdown body theo khái niệm và quyết định có tính ổn định.
4. Thêm tag để dễ tìm.
5. Link Doc với Plan hoặc thêm vào Project khi Doc cung cấp ngữ cảnh cho công
   việc đang thực hiện.

Không lưu dữ liệu nhạy cảm hoặc secret trong Doc. Visibility là kiểm soát truy
cập nhưng không phải hệ thống quản lý secret.

## Cộng tác

Doc có thể có một assigner và nhiều assignee. Assignment thể hiện trách nhiệm;
user được chọn phải có quyền xem Doc từ trước.

Linked Plan thể hiện công việc được tạo ra hoặc nhận thông tin từ Doc. Project
membership cung cấp ngữ cảnh project nhưng không thay thế rule truy cập artifact.

Mỗi lần cập nhật nội dung tạo một version. Dùng compare để review và rollback
khi cần đưa body cũ trở thành hiện tại. Assignment history và version history
ghi lại hai loại sự kiện khác nhau.

Agent có thể lấy Doc được phép truy cập qua MCP resource hoặc tool, tùy khả năng
của client.

Xem [Plan](/help/plans), [Project](/help/projects) và
[Chia sẻ và phân công](/help/sharing-and-assignment).
