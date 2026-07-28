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

## Xem hồ sơ user

Chọn một user từ danh sách member, comment, assignment, Workflow hoặc bề mặt
cộng tác khác để mở hồ sơ.

Hồ sơ hiển thị:

- thông tin định danh account và lần đăng nhập thành công gần nhất;
- membership trực tiếp tại Organization, Department và Team;
- các group cha được kế thừa;
- trách nhiệm hiện tại trên Doc, Plan và Workflow mà bạn có quyền xem;
- hành động do user thực hiện và sự kiện tác động tới user.

Tên membership và direct role đóng vai trò directory nội bộ. Group chỉ có link
khi bạn có quyền mở group đó. Activity của Artifact, Project và Workflow được
lọc theo quyền của chính người xem, vì vậy hồ sơ không cấp quyền vào nội dung
private.

`Last login` chỉ ghi lần đăng nhập thành công gần nhất. `Never signed in` thường
có nghĩa account được admin tạo nhưng chưa từng được sử dụng.

## Quản lý platform user

Superadmin còn thấy phương thức đăng nhập và action quản trị trên hồ sơ. Trước
khi xóa hoặc thay đổi user:

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
