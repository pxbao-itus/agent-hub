## Workflow theo dõi điều gì

Workflow đại diện cho một chuỗi stage có thể lặp lại. Mỗi stage có trạng thái,
execution note và acceptance criteria tùy chọn, một user chịu trách nhiệm, due
date và các artifact cần thiết để thực hiện phần công việc đó.

Dùng Workflow khi tiến độ phụ thuộc vào việc đi qua một quy trình, không chỉ là
hoàn thành một nhóm task không có thứ tự.

## Tạo và vận hành Workflow

1. Chọn owner group và tùy chọn link một Project.
2. Định nghĩa stage với tên mô tả kết quả hoặc checkpoint.
3. Sắp xếp stage theo thứ tự thực hiện dự kiến.
4. Thêm ngữ cảnh Markdown và acceptance criteria ngắn gọn khi việc handoff cần
   nhiều thông tin hơn tên stage.
5. Tùy chọn assign một user chịu trách nhiệm và due date. Assignment không cấp
   quyền truy cập; chỉ user đã xem được Workflow mới có thể được chọn.
6. Gắn Prompt, Skill, Doc hoặc Plan tại nơi cần dùng.
7. Chuyển stage qua todo, doing và done khi công việc tiến triển. Manager và
   user chịu trách nhiệm đều có thể báo cáo status.
8. Theo dõi progress tổng thể và activity gần đây.

Artifact vẫn có ownership và version độc lập. Gắn artifact vào stage không tạo
bản copy và không bỏ qua rule truy cập.

## Giữ quy trình hữu ích

- Dùng stage cho transition có ý nghĩa, không dùng cho mọi task nhỏ.
- Đưa bước thực hiện chi tiết vào Plan hoặc Skill.
- Đưa tài liệu tham chiếu vào Doc.
- Review attachment khi quy trình thay đổi để agent không lấy chỉ dẫn lỗi thời.

Khi Workflow được link với Project, progress xuất hiện trong ngữ cảnh Project.
Project membership và quyền truy cập artifact vẫn là hai khái niệm riêng.
Stage được assign và còn quyền truy cập cũng xuất hiện trong **My Work**. MCP
client có write scope nhận cùng execution context và tuân theo cùng rule status.

Xem [Project](/help/projects) và [Plan](/help/plans).
