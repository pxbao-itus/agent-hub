## Agent Hub dùng để làm gì

Agent Hub lưu các khối nội dung tái sử dụng cho người dùng và AI agent trong một
nơi có version, tìm kiếm và phân quyền. Thay vì sao chép chỉ dẫn giữa nhiều cuộc
trò chuyện hoặc project, team có thể duy trì một nguồn chung và để user hoặc
agent có quyền lấy phiên bản hiện tại.

Các loại artifact chính:

- **Prompt** — nội dung tái sử dụng, có thể chứa biến.
- **Skill** — chỉ dẫn kèm file hỗ trợ tùy chọn cho agent.
- **Doc** — tài liệu tham chiếu cho plan và project.
- **Plan** — phần tổng quan và danh sách task có thể theo dõi.

Project gom doc và plan theo một sáng kiến. Workflow chia công việc thành các
stage và có thể gắn artifact cần thiết cho từng stage.

## Cá nhân hóa dashboard

Các overview card trên dashboard mở trang nội dung hoặc settings tương ứng.
Chọn **Customize cards** để đổi thứ tự, ẩn card không cần dùng hoặc thêm lại
card đang bị ẩn. Thay đổi được lưu theo tài khoản và đồng bộ giữa các trình
duyệt, thiết bị. **Cancel** bỏ bản chỉnh sửa hiện tại; **Reset** khôi phục thứ
tự sáu card mặc định sau khi bạn lưu.

## Hiểu space và visibility

Mỗi artifact thuộc personal space hoặc một organization, department hay team.
Owner space quyết định ai có thể quản lý. Visibility quyết định ai có thể tìm
thấy và xem nội dung.

- Dùng personal space cho bản nháp hoặc nội dung thuộc riêng bạn.
- Dùng group space khi team cần cùng duy trì artifact.
- Dùng chia sẻ khi cần cấp quyền cho một người ngoài luồng quyền của group.

Tạo artifact trong group không tự cấp quyền cho user không liên quan. Assignment
cũng không tự cấp quyền truy cập.

## Hoàn thành luồng đầu tiên

1. Tìm artifact có sẵn trước khi tạo nội dung trùng lặp.
2. Chọn loại artifact phù hợp với mục đích.
3. Chọn đúng owner space và visibility.
4. Thêm title rõ ràng, description ngắn, tag hữu ích và nội dung tái sử dụng.
5. Lưu artifact và kiểm tra trang chi tiết.
6. Thêm vào project hoặc workflow nếu artifact thuộc một phạm vi lớn hơn.
7. Nếu AI agent cần sử dụng, tạo MCP token có scope và kết nối client.

Mỗi lần lưu tiếp theo tạo một version bất biến. Bạn có thể xem, so sánh hoặc
rollback mà không xóa lịch sử.

## Thói quen nên áp dụng

- Ưu tiên artifact có mục đích rõ thay vì một tài liệu lớn chứa nhiều việc không
  liên quan.
- Dùng tag ổn định, mô tả domain hoặc mục đích.
- Đặt nội dung dùng chung vào group space hẹp nhất nhưng vẫn phù hợp.
- Chỉ cấp cho token và user các quyền thực sự cần.
- Xem Doc là nguồn tham chiếu, Plan là công việc thực thi và Project là nơi kết
  nối chúng.

Tiếp tục với [Tìm và tái sử dụng nội dung](/help/finding-content), hoặc chọn bài
hướng dẫn cho loại artifact bạn muốn tạo.
