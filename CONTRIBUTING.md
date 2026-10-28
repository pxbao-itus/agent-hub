# Contributing to Agent Hub

Thanks for your interest. Issues, ideas and pull requests are welcome. For
anything larger than a small fix, please open an issue first so we can agree on
the approach before you spend time on it.

## Development setup

Requirements: Node 22+, pnpm 11, Docker. The CLI in `cli/` additionally needs
Go (see `cli/go.mod`).

```bash
pnpm install
cp .env.example .env         # set AUTH_SECRET (openssl rand -base64 32)
docker compose up -d db      # Postgres + pgvector
pnpm db:push                 # create tables
pnpm db:seed                 # optional sample data
pnpm dev                     # http://localhost:3000
```

`server/db/schema.ts` is the single source of truth for the database. There is
no migration history; `drizzle-kit push` applies the schema directly.

## Checks

Run these before opening a pull request. CI runs the same set.

```bash
pnpm exec tsc --noEmit       # typecheck
pnpm lint
pnpm test                    # unit tests, no database needed
pnpm test:integration        # needs TEST_DATABASE_URL, see below
(cd cli && go vet ./... && go test ./...)
```

Integration tests (`*.itest.ts`) run against a separate database whose name
must end in `_test`, so they never touch development data:

```bash
# in .env
TEST_DATABASE_URL="postgresql://agenthub:agenthub@localhost:5432/agenthub_test"
```

Create that database once (with `CREATE EXTENSION vector;`), run
`pnpm db:push` against it, then use `pnpm test:integration`, which reseeds
fixtures before running.

## Project layout

- `app/` — Next.js App Router pages and layouts
- `server/` — tRPC routers, services, MCP server, database schema
- `components/` — React components
- `content/help/` — the bilingual (English/Vietnamese) in-app user guide;
  see [`content/help/CONTRIBUTING.md`](content/help/CONTRIBUTING.md)
- `cli/` — the `agenthub` Go CLI, released separately (see
  [`cli/RELEASING.md`](cli/RELEASING.md))

## Pull requests

- Keep a pull request focused on one change.
- Add or update tests for behavior you change.
- Write commit messages in English, in the imperative mood
  (`fix(search): handle empty query`).
- Update the README or the in-app help when user-visible behavior changes.

By contributing you agree that your contribution is licensed under the
project's [MIT License](LICENSE).
