# prompt-hub

> Open-source platform to **store, share, and use prompts** — with first-class **AI agent integration over MCP**.

prompt-hub là nơi quản lý prompt tập trung cho cá nhân và tổ chức: lưu trữ, phân quyền theo **Organization → Department → Team → User**, versioning, và cho phép AI agent lấy prompt mới nhất **qua MCP** thay vì copy-paste.

> ⚠️ **Status: early / work-in-progress.** Đang trong giai đoạn thiết kế & xây MVP. Chưa sẵn sàng cho production.

## Tính năng (mục tiêu MVP)

- 📦 **Quản lý prompt** với tags, mô tả, và biến template `{{var}}`.
- 🕑 **Versioning** — mỗi lần lưu là một version immutable.
- 🏢 **Phân quyền theo tổ chức** — owner là user hoặc team/department/org, kế thừa quyền theo cấp.
- 🔌 **MCP server tích hợp** — cắm vào Claude Code, Cursor, hay bất kỳ agent hỗ trợ MCP. Dùng token có scope.
- 🔎 **Tìm kiếm** — full-text (MVP) → semantic / hybrid search (kế tiếp).
- 🔐 **Đa phương thức đăng nhập** — basic auth, Google, GitHub (pluggable).

## Tech stack

Next.js (full-stack) · PostgreSQL + pgvector · Drizzle ORM · Auth.js · MCP TypeScript SDK.

Nguyên tắc: ít phụ thuộc — toàn TypeScript + một Postgres, self-host bằng một lệnh.

## Self-host

```bash
docker compose up
```

_(Hướng dẫn chi tiết sẽ bổ sung khi MVP sẵn sàng.)_

## License

_TBD._

## Contributing

Dự án còn rất sớm. Issue & ý tưởng đều được hoan nghênh.
