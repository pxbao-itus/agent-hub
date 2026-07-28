## Sharing và assignment giải quyết hai vấn đề khác nhau

**Sharing** cấp cho một user cụ thể quyền truy cập artifact ngoài luồng
permission thông thường của owner space.

**Assignment** ghi nhận trách nhiệm đối với Doc hoặc Plan. Nó xác định ai giao
việc và ai được kỳ vọng thực hiện.

Assign một user không cấp quyền truy cập. User phải xem được artifact từ trước
thông qua group membership, visibility hoặc share trực tiếp.

## Chia sẻ có chủ đích

Trước khi share, hãy cân nhắc user có nên thuộc owner group hay không. Dùng share
trực tiếp cho ngoại lệ rõ ràng hoặc cộng tác chéo group.

Visibility và sharing quyết định quyền đọc. Quyền chỉnh sửa vẫn phụ thuộc vào
effective permission của user.

## Phân công trách nhiệm

Một Doc hoặc Plan có:

- một **assigner** hiệu lực;
- không hoặc nhiều **assignee**.

Default assigner được resolve từ ownership và ngữ cảnh tạo cho đến khi editor có
quyền thay đổi. Chỉ thêm nhiều assignee khi trách nhiệm thực sự được chia sẻ.

Thay đổi assignment xuất hiện trong activity timeline hợp nhất và có thể gửi thông báo
cho user liên quan. Xóa assignee chỉ xóa bản ghi trách nhiệm, không xóa quyền
truy cập có sẵn của user.

## Làm việc với My Work

Mở **My Work** để xem:

- Doc và Plan được assign cho bạn;
- Workflow stage mà bạn là user chịu trách nhiệm;
- công việc bạn điều phối với vai trò effective assigner;
- công việc bạn có quyền quản lý nhưng chưa có assignee.

Dùng bộ lọc status, priority, due date, loại artifact và trạng thái hạn để thu
gọn danh sách. Assignment status áp dụng cho toàn bộ Doc hoặc Plan; nó không
thay thế status của từng task bên trong Plan.
Trách nhiệm trên Workflow stage là khái niệm riêng: user chịu trách nhiệm được
báo cáo status của stage đó, nhưng không được cấp thêm quyền xem Workflow hoặc
quyền sửa cấu trúc.

Bật **Needs attention** để chỉ xem công việc đang blocked, quá hạn hoặc có hoạt
động thảo luận chưa đọc.

Assignee được cập nhật status. Thay đổi priority, due date, assigner hoặc danh
sách assignee cần quyền chỉnh sửa artifact. Due date trong phiên bản này dùng
để hiển thị và lọc: Agent Hub đánh dấu công việc quá hạn nhưng chưa gửi reminder
theo lịch.

MCP client có write scope có thể đọc My Work và cập nhật cùng các assignment
field. Token scope và permission của artifact vẫn luôn được áp dụng.

## Thảo luận và bàn giao công việc

Mỗi Doc và Plan có một luồng thảo luận Markdown phẳng. Dùng `@username` để kéo
user có quyền xem artifact vào cuộc trao đổi. Nếu username không tồn tại hoặc
user đó không xem được artifact, comment vẫn được lưu nhưng mention chỉ là text
thường và không tạo notification.

Gõ `@` để mở danh sách user có thể mention. Editor vẫn giữ `@username` ổn định;
sau khi đăng, comment hiển thị display name và cho xem username khi hover.

Bạn có thể sửa hoặc xóa comment của mình. Người quản lý artifact cũng có thể
moderate comment. Comment đã xóa vẫn để lại tombstone để timeline không mất ngữ
cảnh.

Follow preference cho phép nhận mọi cập nhật thảo luận, chỉ nhận mention hoặc
mute artifact. Assignment có thể tự động follow artifact, nhưng preference do
user đặt rõ ràng như muted luôn được giữ lại.

Phần Activity hợp nhất comment, version, thay đổi assignment và thay đổi liên
kết project. Bản compact hiện sự kiện gần nhất; mở timeline đầy đủ khi cần xem
lịch sử cũ hơn.

## Xử lý khi không assign được

1. Xác nhận user tồn tại và đang hoạt động.
2. Kiểm tra user có mở được artifact không.
3. Thêm membership phù hợp hoặc share artifact.
4. Thử assignment lại.

Xem [Space và phân quyền](/help/spaces-and-permissions) để hiểu access model.
