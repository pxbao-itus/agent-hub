## System role và group role

Agent Hub có hai lớp permission.

Mỗi account có thêm một **username** duy nhất và cố định để mention. Username
chỉ gồm chữ cái tiếng Anh viết thường và số, bắt đầu bằng chữ cái, và được hiển
thị dưới dạng `@username`. Username vẫn định danh đúng account khi display name
thay đổi. Hãy chọn cẩn thận khi tạo account vì username không thể chỉnh sửa về
sau.

**System role**

- `user` — tài khoản platform thông thường.
- `superadmin` — quản trị toàn instance và bypass access.

**Group role**

- `viewer` — đọc nội dung có quyền thông qua group.
- `editor` — đọc và duy trì artifact thuộc group.
- `admin` — quản lý quyền group và thao tác quản trị.

Một user có thể có role khác nhau ở các group khác nhau. Role ở group tổ tiên có
thể áp dụng xuống group con, trong khi role cấp thấp không cấp quyền lên parent.

## Quản lý platform user

Superadmin có thể tạo và duy trì account trên platform. Trước khi xóa hoặc thay
đổi user:

1. Xác định membership, artifact sở hữu, project và assignment liên quan.
2. Chuyển trách nhiệm khi cần.
3. Revoke token không còn được sử dụng.
4. Chọn thay đổi role nhỏ nhất nhưng vẫn giải quyết nhu cầu access.

Không nên dùng superadmin làm role làm việc hằng ngày.

## Quản lý group membership

Group admin có thể thêm user và chọn viewer, editor hoặc admin phù hợp. Thêm user
vào group hẹp nhất bao phủ trách nhiệm của họ.

Thay đổi membership có thể ảnh hưởng quyền kế thừa với artifact ở group con.
Direct share có thể vẫn tồn tại sau khi membership bị xóa, vì vậy cần review các
share ngoại lệ riêng.

Dùng audit log để kiểm tra thay đổi permission quan trọng. Dùng artifact sharing
cho cộng tác cụ thể thay vì cấp group role quá rộng.

Xem [Space và phân quyền](/help/spaces-and-permissions) và
[Audit log](/help/audit-log).
