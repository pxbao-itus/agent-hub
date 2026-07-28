## Bài này dành cho ai

Bài này chủ yếu dành cho organization admin và group admin. User thông thường
cũng có thể dùng để hiểu vì sao một artifact có thể xem hoặc chỉnh sửa.

## Cấu trúc group

Agent Hub tổ chức quyền sở hữu dùng chung theo:

**Organization → Department → Team**

Group role có thể được kế thừa theo cấu trúc này. Ví dụ, organization admin có
thể quản lý các group bên dưới organization. Hành động cụ thể vẫn phụ thuộc vào
role và loại tài nguyên đang thay đổi.

System role và group role là hai khái niệm khác nhau:

- **System role** áp dụng cho toàn bộ Agent Hub. Superadmin là system role có
  quyền cao.
- **Group role** chỉ áp dụng trong organization, department hoặc team.

Nên cấp role thấp nhất nhưng vẫn đủ để user hoàn thành công việc.

## Ownership và visibility

Một artifact có một owner space. Ownership xác định group chịu trách nhiệm duy
trì artifact, không chỉ đơn thuần là thư mục lưu trữ.

Visibility có mục đích riêng:

- **Private** dành cho artifact cá nhân.
- **Group** cho phép nội dung thuộc group xuất hiện trong phạm vi quyền group.
- **Public** cho phép user đã đăng nhập bên ngoài owner group tìm thấy artifact.

Public không đồng nghĩa mọi người đều có quyền chỉnh sửa. Quyền thay đổi vẫn đến
từ ownership, role hoặc quyền được cấp rõ ràng.

## Chia sẻ và assignment

Chia sẻ cấp quyền cho một user cụ thể bên ngoài luồng group thông thường. Chỉ
dùng cho ngoại lệ có chủ đích, không dùng để thay thế membership đúng.

Assignment ghi nhận trách nhiệm đối với Doc hoặc Plan. Assignment **không** cấp
quyền truy cập. Trước khi assign, cần đảm bảo user đã xem được artifact thông qua
membership, visibility hoặc chia sẻ.

## Quy trình quản trị đề xuất

1. Tạo cấu trúc organization theo các ranh giới trách nhiệm ổn định.
2. Thêm user vào group hẹp nhất nhưng phù hợp.
3. Chỉ cấp admin hoặc editor tại nơi thực sự cần.
4. Tạo artifact dùng chung trong group chịu trách nhiệm duy trì.
5. Dùng chia sẻ cho cộng tác chéo group có tính ngoại lệ.
6. Kiểm tra membership và audit log khi quyền truy cập thay đổi ngoài dự kiến.

Xóa membership có thể làm mất quyền kế thừa. Hãy kiểm tra project, assignment và
công việc dùng chung trước khi đổi role hoặc xóa user.
Profile user hiển thị đầy đủ cây membership trực tiếp của người đó. Tên group
chỉ có link khi bạn được phép mở trang quản trị của group tương ứng.

Xem [User và role](/help/users-and-roles) để quản lý membership và
[Chia sẻ và phân công](/help/sharing-and-assignment) để hiểu quy tắc cộng tác.
