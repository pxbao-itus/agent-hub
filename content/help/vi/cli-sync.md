## Khi nào dùng CLI

MCP cho phép agent lấy nội dung khi cần. Dùng Agent Hub CLI khi Claude Code hoặc
Codex cần discover Skill native từ filesystem local.

Claude là target mặc định và cài vào `.claude/skills/`. Codex cài vào
`.agents/skills/`.

## Kết nối và pull

Mở **Integrations → CLI**. Bản macOS Preview hỗ trợ Apple Silicon và Intel:

- dùng lệnh terminal để tự phát hiện kiến trúc và kiểm tra checksum; hoặc
- tải archive đúng kiến trúc theo cách thủ công.

Ubuntu và Windows hiện chỉ hiển thị trạng thái coming soon và chưa thể tải.
Binary macOS chưa được Apple sign hoặc notarize. Installer không dùng sudo,
không sửa shell profile và không thay đổi thiết lập bảo mật macOS.

Sau khi cài:

1. Chạy `agenthub version`.
2. Tạo MCP token và login bằng lệnh trên trang CLI.
3. Pull một Skill theo slug, hoặc dùng `pull skill --all` để cài mọi Skill mà
   token hiện tại truy cập được.
4. Dùng `--target codex` khi cài cho Codex; nếu bỏ target thì mặc định là
   Claude.
5. Review file được tạo trước khi cho agent chạy script.

Cấu hình login được lưu trong user profile với file permission hạn chế. Luôn bảo
vệ token.

Trên màn hình chi tiết Skill, **Use with CLI** mở trang cài đặt với lệnh pull
một Skill đã được chuẩn bị theo canonical slug. Token không được đưa vào link
đó.

## Theo dõi và đồng bộ

Workspace lock file ghi nhận remote Skill cùng installation Claude/Codex độc
lập. Dùng `status` hoặc `--dry-run` để preview mà không ghi file. Dùng `sync`
để refresh các Skill đang được track của target đã chọn.

Agent Hub là source of truth cho managed Skill. Pull và sync ghi đè thay đổi
local, thay toàn bộ Skill tree được quản lý và xóa bundled file đã stale.

Managed Skill cũng bị xóa local khi biến mất khỏi accessible set của token hiện
tại. Delete, mất membership, đổi visibility hoặc thu hẹp token scope được xử lý
giống nhau. CLI không ghi đè hoặc xóa Skill local không được track. Không chỉnh
lock file thủ công.

Thay đổi filesystem và lock file dùng transaction có thể phục hồi. Nếu lần
apply trước bị gián đoạn, lệnh pull hoặc sync tiếp theo sẽ khôi phục snapshot
hoàn chỉnh trước đó rồi mới tiếp tục.

Claude gọi Skill bằng `/skill-name`. Codex gọi bằng `$skill-name` hoặc chọn qua
`/skills`.

Tên mặc định có dạng `agenthub-<short-slug>`. Nếu dùng `--as custom-name`, tên
được giữ chính xác là `custom-name`. Tên mặc định cũ của managed Skill được
migrate bằng transaction ở lần pull hoặc sync tiếp theo.

Dùng `agenthub clean` để xem danh sách managed Skill của Claude và Codex rồi
xác nhận xóa khỏi workspace hiện tại. Thêm `--target claude|codex` để giới hạn
target, `--dry-run` để chỉ preview hoặc `--yes` cho automation.

## Sử dụng an toàn

- Review bundled script như code từ một repository khác.
- Dùng token có scope.
- Chạy `status` hoặc `--dry-run` trước bulk sync sau khi permission hoặc token
  scope thay đổi.
- Lưu custom có chủ đích lên Agent Hub thay vì sửa managed local copy.
- Chạy lại installer versioned để update. Xóa
  `~/.local/bin/agenthub` để uninstall vị trí mặc định.

Xem [Kết nối AI agent](/help/connect-agent) để thiết lập token.
