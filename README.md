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

## Self-host with Docker Compose

Requirements: Docker 24+, Docker Compose v2.

```bash
git clone https://github.com/your-org/prompt-hub.git
cd prompt-hub

cp .env.example .env
# Edit .env:
#   AUTH_SECRET — run: openssl rand -base64 32
#   NEXTAUTH_URL — set to your public URL (e.g. https://prompts.example.com)

# Build and start (Postgres + app)
docker compose up -d --build

# Apply database migrations (first run only)
docker compose exec app node node_modules/.bin/drizzle-kit migrate

# Create a superadmin account (first run only)
# Set ROOT_EMAIL + ROOT_PASSWORD in .env first, then:
docker compose exec app npx tsx server/scripts/create-superadmin.ts

# App is now running at http://localhost:3000
```

To update to a new version:

```bash
git pull
docker compose up -d --build
docker compose exec app node node_modules/.bin/drizzle-kit migrate
```

## Development

Requirements: Node 20+, pnpm, Docker.

```bash
pnpm install                 # install dependencies
cp .env.example .env         # configure env (set AUTH_SECRET)
docker compose up -d db      # Postgres only
pnpm db:migrate              # create tables
pnpm db:seed                 # (optional) seed sample data
pnpm dev                     # http://localhost:3000
```

Other DB commands: `pnpm db:generate` (generate migration from schema), `pnpm db:push`, `pnpm db:studio`.

## Connecting an AI agent via MCP

1. Sign in and go to **Settings → MCP Tokens**.
2. Generate a token (it is shown only once — copy it).
3. Add to your agent config:

**Claude Code** (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "prompt-hub": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Bearer mcp_<your-token>" }
    }
  }
}
```

Once connected, type `/` in Claude Code to see your prompts as slash commands.

## License

_TBD._

## Contributing

The project is in early stages. Issues and ideas are welcome.
