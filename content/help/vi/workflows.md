## Workflow theo dõi điều gì

Workflow đại diện cho một chuỗi stage có thể lặp lại. Mỗi stage có trạng thái và
có thể reference artifact cần thiết để thực hiện phần công việc đó.

Dùng Workflow khi tiến độ phụ thuộc vào việc đi qua một quy trình, không chỉ là
hoàn thành một nhóm task không có thứ tự.

## Tạo và vận hành Workflow

1. Chọn owner group và tùy chọn link một Project.
2. Định nghĩa stage với tên mô tả kết quả hoặc checkpoint.
3. Sắp xếp stage theo thứ tự thực hiện dự kiến.
4. Gắn Prompt, Skill, Kit, Doc hoặc Plan tại nơi cần dùng.
5. Chuyển stage qua todo, doing và done khi công việc tiến triển.
6. Theo dõi progress tổng thể từ trạng thái các stage.

Artifact vẫn có ownership và version độc lập. Gắn artifact vào stage không tạo
bản copy và không bỏ qua rule truy cập.

## Giữ quy trình hữu ích

- Dùng stage cho transition có ý nghĩa, không dùng cho mọi task nhỏ.
- Đưa bước thực hiện chi tiết vào Plan hoặc Skill.
- Đưa tài liệu tham chiếu vào Doc.
- Review attachment khi quy trình thay đổi để agent không lấy chỉ dẫn lỗi thời.

Khi Workflow được link với Project, progress xuất hiện trong ngữ cảnh Project.
Project membership và quyền truy cập artifact vẫn là hai khái niệm riêng.

Xem [Project](/help/projects) và [Plan](/help/plans).
