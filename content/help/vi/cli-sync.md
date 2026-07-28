## Khi nào dùng CLI

MCP cho phép agent lấy nội dung khi cần. Dùng Agent Hub CLI khi công cụ yêu cầu
Skill hoặc script tồn tại trên filesystem local như `.claude/skills/`.

CLI hỗ trợ pull Skill từ một Agent Hub instance đang chạy.

## Kết nối và pull

Build hoặc cài CLI theo CLI README của project, sau đó:

1. Login bằng Agent Hub base URL và MCP token.
2. Pull Skill theo slug để cài instruction file và bundled files.
3. Review file được tạo trước khi cho agent chạy script.

Cấu hình login được lưu trong user profile với file permission hạn chế. Luôn bảo
vệ token.

## Theo dõi và đồng bộ

Workspace lock file ghi nhận nội dung và version đã cài. Dùng `status` để preview
thay đổi mà không ghi file. Dùng `sync` để lấy version mới hơn của nội dung đang
được theo dõi.

Nếu file đã thay đổi local và server cũng có version mới, sync thông thường báo
conflict và giữ file local. Chỉ force overwrite sau khi review hoặc backup thay
đổi local.

File bị xóa hoặc đổi tên trong Skill version mới trên server được dọn trong quá
trình sync. Không chỉnh lock file thủ công.

## Sử dụng an toàn

- Review bundled script như code từ một repository khác.
- Dùng token có scope.
- Chạy `status` trước khi sync workspace đã chỉnh sửa.
- Commit công việc local có chủ đích trước khi force overwrite.

Xem [Kết nối AI agent](/help/connect-agent) để thiết lập token.
