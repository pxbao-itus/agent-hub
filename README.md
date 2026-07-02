# Agent Hub

> Open-source platform to **store, share, and use reusable building blocks for AI agents** — prompts, skills, kits, plans, and docs — with first-class **agent integration over MCP**.

Instead of copy-pasting prompts and instructions between projects, keep them in one place: versioned, access-controlled across **Organization → Department → Team → User**, searchable by meaning, and pulled straight into your AI agent through the Model Context Protocol (MCP). No copy-paste, always the latest version.

> ⚠️ **Status: early / work-in-progress.** Usable for self-hosting, but APIs and schema may still change. Not yet hardened for production.

## Features

- 📦 **Prompts** — with tags, descriptions, and template variables `{{var}}`.
- 🛠️ **Skills** — reusable instruction sets (SKILL.md) with bundled files, delivered to agents on demand.
- 🎒 **Kits** — bundle multiple prompts and skills into one shareable unit; members are resolved recursively.
- ✅ **Plans** — structured task lists (todo / doing / done) that agents can read and update.
- 📄 **Docs** — free-form markdown docs, linkable to the plans they inform.
- 🕑 **Versioning** — every save creates an immutable version, with diff and rollback.
- 🔎 **Semantic + hybrid search** — full-text (BM25) fused with vector similarity (bge-m3 + pgvector) via Reciprocal Rank Fusion, across every artifact kind. A global search page and a `Cmd/Ctrl-K` command palette. Degrades gracefully to keyword-only when embeddings are disabled.
- 🏢 **Org-based access control** — an artifact's owner can be a user, team, department, or org; permissions inherit upward. Plus per-user sharing for one-off grants.
- 🔌 **MCP server** — plug into Claude Code, Cursor, or any MCP-compatible agent using a scoped token. Prompts appear as slash commands; skills, kits, plans, and docs are fetched via tools.
- 🔐 **Multiple auth providers** — basic auth (Credentials), Google, and GitHub, all pluggable via env.
- 🌗 **Markdown rendering** with light/dark themes.

## Tech stack

- **Full-stack**: [Next.js 16](https://nextjs.org) (App Router) + React 19, [tRPC v11](https://trpc.io)
- **Database**: PostgreSQL + [pgvector](https://github.com/pgvector/pgvector) (relational + full-text + vector, all in one DB)
- **ORM**: [Drizzle](https://orm.drizzle.team)
- **Auth**: [Auth.js](https://authjs.dev) (next-auth v5), argon2id password hashing
- **MCP**: official [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- **Embeddings**: pluggable — local [transformers.js](https://huggingface.co/docs/transformers.js) (bge-m3, multilingual) by default, or a remote HTTP embedding server, switchable via env
- **UI**: Tailwind CSS v4 + Radix UI primitives, react-markdown, lucide icons
- **Validation**: Zod

One principle: minimal moving parts — all TypeScript on top of a single Postgres, self-hosted with one command.

## Self-host with Docker Compose

Requirements: Docker 24+, Docker Compose v2.

```bash
git clone https://github.com/your-org/agent-hub.git
cd agent-hub

cp .env.example .env
# Edit .env:
#   AUTH_SECRET   — run: openssl rand -base64 32
#   NEXTAUTH_URL  — set to your public URL (e.g. https://hub.example.com)
#   ROOT_EMAIL / ROOT_PASSWORD — for the first superadmin (see below)

# Build and start (Postgres + app) — the app container applies the database
# schema itself on every boot, so this is the only command you need.
docker compose up -d --build

# Create a superadmin account (first run only; reads ROOT_EMAIL/ROOT_PASSWORD from .env)
docker compose exec app npx tsx server/scripts/create-superadmin.ts

# App is now running at http://localhost:3000
```

To update to a new version:

```bash
git pull
docker compose up -d --build
```

> The container applies the schema (`drizzle-kit push`, non-interactively)
> before starting on every boot — there's no separate migration step to run.
> This means a schema change that would involve data loss (e.g. a dropped
> column) also applies automatically on next restart, with no confirmation
> prompt. Review `schema.ts` changes before deploying, the same care a
> hand-run migration would need anyway.

## Development

Requirements: Node 22+, pnpm, Docker.

```bash
pnpm install                 # install dependencies
cp .env.example .env         # configure env (set AUTH_SECRET)
docker compose up -d db      # Postgres only
pnpm db:push                 # create tables
pnpm db:seed                 # (optional) seed sample data
pnpm dev                     # http://localhost:3000
```

A `Makefile` wraps the common flows: `make setup` (DB up + push + dev), `make db/up`, `make db/push`, `make db/seed`, `make db/create-root email=you@example.com password=secret`, `make test`, `make typecheck`.

Other DB commands: `pnpm db:studio`.

> `schema.ts` is the single source of truth — there's no versioned migration
> history. `drizzle-kit push` diffs it against the live database and applies
> the difference directly; run it again after pulling any update that
> touches the schema.

## Search & embeddings

Semantic search is **opt-in** via the `EMBEDDER` env var, so a minimal self-host stays lightweight:

| `EMBEDDER` | Behavior |
| --- | --- |
| `null` (default) | No embeddings — keyword-only full-text search. |
| `local` | Runs bge-m3 in-process via transformers.js. Downloads ~1–2 GB of model weights on first run (cache with `HF_HOME`). |
| `remote` | Calls a self-hosted HTTP embedding server (HuggingFace Text Embeddings Inference, also bge-m3). Set `EMBEDDER_URL` to its base URL. No local model download. |

When embeddings are enabled, a background reconciler backfills vectors for existing artifacts, and search automatically upgrades from keyword-only to hybrid. The model identity is stored alongside each vector, so switching embedders re-indexes cleanly without mixing incompatible vectors. Inspect or clean up stored vectors with `pnpm db:reindex` (list) and `pnpm db:reindex --purge <embedderId>`.

> The embedding column is a fixed `vector(1024)` with an HNSW index (sized for bge-m3). Switching to a model with a different dimensionality needs a schema migration (new column/index), not just an env change.

## Connecting an AI agent via MCP

1. Sign in and go to **Settings → MCP Tokens**.
2. Generate a token (it is shown only once — copy it). Tokens can be scoped to specific spaces and tags.
3. Add it to your agent config:

**Claude Code** (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "agent-hub": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Bearer mcp_<your-token>" }
    }
  }
}
```

Once connected:

- Your accessible **prompts** show up as slash commands (type `/` in Claude Code).
- Use **`search_artifacts`** to find anything by meaning or keyword across all kinds.
- Pull specific artifacts with **`get_skill`**, **`get_kit`**, **`get_plan`**, **`get_doc`** (and their `list_*` counterparts).
- Agents can update plan progress with **`update_task_status`**.

## License

Intended license: **MIT**. The `LICENSE` file will be added with the first tagged release.

## Contributing

The project is in early stages. Issues, ideas, and feedback are welcome.
