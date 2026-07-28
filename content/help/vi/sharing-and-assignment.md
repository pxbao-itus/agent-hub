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

Thay đổi assignment xuất hiện trong assignment history và có thể gửi thông báo
cho user liên quan. Xóa assignee chỉ xóa bản ghi trách nhiệm, không xóa quyền
truy cập có sẵn của user.

## Xử lý khi không assign được

1. Xác nhận user tồn tại và đang hoạt động.
2. Kiểm tra user có mở được artifact không.
3. Thêm membership phù hợp hoặc share artifact.
4. Thử assignment lại.

Xem [Space và phân quyền](/help/spaces-and-permissions) để hiểu access model.
