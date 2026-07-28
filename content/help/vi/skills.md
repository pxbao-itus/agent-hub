## Khi nào dùng Skill

Skill mô tả cách AI agent thực hiện một năng lực có thể tái sử dụng. Skill có thể
kèm template, script, example hoặc tài liệu tham chiếu. Dùng Prompt cho chỉ dẫn
text tập trung; dùng Skill khi agent cần một quy trình và ngữ cảnh hỗ trợ.

## Tạo Skill

1. Chọn owner space và visibility.
2. Mô tả năng lực và khi nào agent nên sử dụng.
3. Viết body với input, các bước, ràng buộc và output mong đợi rõ ràng.
4. Thêm bundled file với relative path ổn định nếu quy trình cần.
5. Lưu và kiểm tra Skill đã tạo.

Không đưa secret vào body hoặc bundled file. Ưu tiên file nhỏ, có mục đích rõ
thay vì sao chép cả repository.

## Đưa Skill tới agent

Agent kết nối qua MCP có thể xem hoặc lấy Skill mà nó được phép truy cập. Khi
agent cần chạy script hoặc dùng file trên filesystem, sử dụng Agent Hub CLI để
pull Skill vào workspace local.

Mỗi lần lưu tạo version mới cho body và bundled files. Nên review version trước
khi cập nhật Skill được dùng rộng rãi vì agent có thể lấy version mới nhất ngay
sau đó.

Skill có thể được đưa vào Kit để team phân phối một nhóm năng lực liên quan cùng
nhau.

Xem [Đồng bộ filesystem bằng CLI](/help/cli-sync) và [Kit](/help/kits).
