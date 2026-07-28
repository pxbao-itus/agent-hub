## Audit log ghi lại điều gì

Audit log là màn hình dành cho superadmin để xem sự kiện liên quan bảo mật. Nó
giúp trả lời ai đã thực hiện hành động quan trọng, loại target nào thay đổi và
thay đổi xảy ra khi nào.

Ví dụ:

- xóa artifact hoặc tài nguyên quản trị;
- thay đổi sharing và permission;
- thay đổi membership;
- tạo hoặc revoke token;
- thay đổi project membership và assignment khi có ghi nhận.

Log được sắp theo thời gian và hiển thị actor, action, target cùng ngữ cảnh hiện
có.

## Điều tra một sự kiện

1. Xác định khoảng thời gian và nhóm action.
2. Kiểm tra actor, kể cả trường hợp account đã bị xóa.
3. Đọc target type và metadata summary.
4. Mở tài nguyên liên quan nếu vẫn tồn tại.
5. Đối chiếu membership, sharing, version hoặc assignment history khi cần.

Audit event xác nhận một action đã xảy ra nhưng không phải lúc nào cũng chứa đầy
đủ nội dung trước và sau thay đổi.

## Hiểu giới hạn

Audit log không ghi mọi chỉnh sửa nội dung thông thường. Thay đổi body nằm trong
version history. Thay đổi assigner và assignee có assignment timeline riêng.
Task và Workflow status là operational state.

Audit log chỉ dành cho superadmin vì có thể chứa ngữ cảnh bảo mật xuyên
organization. Không copy audit metadata vào artifact public.

Xem [Phiên bản và lịch sử](/help/versions-and-history) và
[User và role](/help/users-and-roles).
