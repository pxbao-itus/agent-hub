## Trước khi kết nối

Bạn cần MCP endpoint của Agent Hub và token được tạo dưới tài khoản của mình.
Token không thể vượt quá quyền hiện tại của user và có thể được giới hạn thêm
theo space, tag, read/write capability hoặc thời hạn.

Nên dùng token riêng cho từng client hoặc environment để có thể revoke mà không
làm gián đoạn integration khác.

## Tạo và bảo vệ token

1. Mở MCP Tokens và tạo token có tên dễ nhận biết.
2. Chỉ chọn space, tag và capability agent thực sự cần.
3. Đặt thời hạn nếu integration chỉ dùng tạm thời.
4. Copy ngay; giá trị đầy đủ chỉ được hiển thị một lần.
5. Lưu token trong secret hoặc environment configuration của client.

Không đưa token vào artifact, screenshot, repository hoặc chat dùng chung.

Nếu muốn Claude Code hoặc Codex discover Skill từ filesystem local, mở
**Integrations → CLI**. CLI dùng MCP token để xác thực nhưng được cài riêng với
cấu hình MCP client.

## Cấu hình client

Dùng example hiển thị trên trang MCP Tokens cho đúng client. Các client có thể
dùng format cấu hình khác nhau dù kết nối cùng HTTP endpoint, vì vậy không copy
JSON của client này sang client khác một cách máy móc.

Với Codex:

- **Codex Desktop:** mở **Settings → Configuration → Open config.toml**, thêm
  đoạn TOML được tạo sẵn, restart ứng dụng, sau đó kiểm tra server tại
  **Settings → MCP servers**.
- **Codex CLI:** dùng lệnh `codex mcp add` được tạo sẵn. Giữ token trong biến
  môi trường `AGENT_HUB_TOKEN`, chạy `codex mcp list`, và dùng `/mcp` bên trong
  Codex để kiểm tra kết nối.

Codex Desktop và Codex CLI dùng chung `~/.codex/config.toml`. Nên ưu tiên biến
môi trường khi dùng CLI; nếu dùng example TOML của Desktop, hãy giữ file ở chế
độ private vì authorization header chứa token.

Sau khi cấu hình:

1. Restart hoặc reload client.
2. Xác nhận tool hoặc prompt của Agent Hub được tìm thấy.
3. Lấy thử một artifact đã biết.
4. Nếu bật write access, chỉ test trên artifact an toàn hoặc personal space.

## Cộng tác thông qua agent

Read token có thể dùng `list_comments` cho thảo luận trên Doc và Plan nằm trong
scope. Write token có thể thêm, sửa, xóa comment và đặt follow preference. Đặt
`@username` trực tiếp trong body để mention user. Tool sẽ báo mention không
resolve được hoặc không có quyền truy cập nhưng không làm fail toàn bộ comment.

Comment do MCP client tạo được ghi rõ source MCP. Comment ID không thể bypass
token scope: update hoặc delete chỉ được phép khi artifact của comment vẫn nằm
trong cả quyền user và scope của token.

## Xử lý lỗi và revoke

Khi lỗi authentication, kiểm tra endpoint, `Bearer` token header, expiry và token
scope. Nếu thiếu artifact, kiểm tra cả quyền user lẫn scope bổ sung của token.

Revoke ngay khi token có thể đã lộ. Revoke không ảnh hưởng account hoặc token
khác.

Hướng dẫn deployment và network nằm trong README của project. Nếu cần cài file
vào local, xem [Đồng bộ filesystem bằng CLI](/help/cli-sync).
