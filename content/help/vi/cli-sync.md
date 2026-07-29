## Khi nào dùng CLI

MCP cho phép agent lấy nội dung khi cần. Dùng Agent Hub CLI khi Claude Code hoặc
Codex cần discover Skill native từ filesystem local.

Claude là target mặc định và cài vào `.claude/skills/`. Codex cài vào
`.agents/skills/`.

## Kết nối và pull

Build hoặc cài CLI theo CLI README của project, sau đó:

1. Login bằng Agent Hub base URL và MCP token.
2. Pull một Skill theo slug, hoặc dùng `pull skill --all` để cài mọi Skill mà
   token hiện tại truy cập được.
3. Dùng `--target codex` khi cài cho Codex; nếu bỏ target thì mặc định là
   Claude.
4. Review file được tạo trước khi cho agent chạy script.

Cấu hình login được lưu trong user profile với file permission hạn chế. Luôn bảo
vệ token.

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

## Sử dụng an toàn

- Review bundled script như code từ một repository khác.
- Dùng token có scope.
- Chạy `status` hoặc `--dry-run` trước bulk sync sau khi permission hoặc token
  scope thay đổi.
- Lưu custom có chủ đích lên Agent Hub thay vì sửa managed local copy.

Xem [Kết nối AI agent](/help/connect-agent) để thiết lập token.
