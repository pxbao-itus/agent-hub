## Chọn cách tái sử dụng phù hợp

Dùng **Duplicate** khi cần một bản được duy trì độc lập trong Agent Hub. Dùng
**Export** và **Import** khi di chuyển nội dung giữa các space, bản backup hoặc
các Agent Hub instance khác nhau.

Link artifact vào Project hoặc Workflow không phải là nhân bản. Item được
link tiếp tục dùng owner và current version gốc.

## Duplicate

Bản duplicate bắt đầu ở version 1 với identity và ownership mới. Hãy review
title, visibility và destination space trước khi chia sẻ.

Dữ liệu riêng theo kind như file của Skill hoặc task của Plan có thể được copy.
Version history và usage counter không trở thành lịch sử của bản mới.

## Export và import

Export tạo bundle có schema version chứa artifact và dữ liệu liên quan được hỗ
trợ. Trước khi import:

1. Kiểm tra nguồn bundle và destination dự kiến.
2. Preview artifact đã parse và dữ liệu đi kèm.
3. Chọn destination space bạn có quyền chỉnh sửa.
4. Xử lý xung đột tên hoặc slug.
5. Import rồi review artifact đã tạo trước khi chia sẻ.

Xem bundle export là dữ liệu, không phải package thực thi đáng tin cậy. Kiểm tra
script hoặc bundled file trước khi cài vào workspace agent.

## Lưu ý về quyền truy cập

Export chỉ chứa thông tin bạn được phép đọc. Import tạo artifact mới nhưng không
cấp thêm quyền truy cập ở destination.

Xem [Skill](/help/skills) và
[Đồng bộ filesystem bằng CLI](/help/cli-sync) cho nội dung agent trên máy local.
