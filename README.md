# prompt-hub

> Open-source platform to **store, share, and use prompts** — with first-class **AI agent integration over MCP**.

Centralized prompt management for individuals and teams: versioning, access control across **Organization → Department → Team → User**, and seamless AI agent integration via MCP — no more copy-pasting.

> ⚠️ **Status: early / work-in-progress.** Not ready for production.

## Features (MVP target)

- 📦 **Prompt management** with tags, descriptions, and template variables `{{var}}`.
- 🕑 **Versioning** — every save creates an immutable version.
- 🏢 **Org-based access control** — owner can be a user, team, department, or org; permissions inherit upward.
- 🔌 **MCP server** — plug into Claude Code, Cursor, or any MCP-compatible agent using a scoped token.
- 🔎 **Search** — full-text (MVP) → semantic / hybrid search (coming next).
- 🔐 **Multiple auth providers** — basic auth, Google, GitHub (pluggable via env).

## Tech stack

Next.js (full-stack) · PostgreSQL + pgvector · Drizzle ORM · Auth.js · MCP TypeScript SDK.

One principle: minimal moving parts — all TypeScript + one Postgres, self-hosted with a single command.

## Development

Requirements: Node 20+, pnpm, Docker.

```bash
pnpm install                 # install dependencies
cp .env.example .env         # configure env (set AUTH_SECRET)
docker compose up -d         # Postgres + pgvector
pnpm db:migrate              # create tables
pnpm db:seed                 # (optional) seed sample data
pnpm dev                     # http://localhost:3000
```

Other DB commands: `pnpm db:generate` (generate migration from schema), `pnpm db:push`, `pnpm db:studio`.

_(Production self-host guide via `docker compose` will be added when MVP is ready.)_

## License

_TBD._

## Contributing

The project is in early stages. Issues and ideas are welcome.
