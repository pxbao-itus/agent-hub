.PHONY: dev build start test test/integration typecheck lint \
        db/up db/down db/push db/studio db/seed db/create-root db/reindex \
        setup install

# ── Dev ──────────────────────────────────────────────────────────────────────

dev:
	pnpm dev

build:
	pnpm build

start:
	pnpm start

# ── DB ───────────────────────────────────────────────────────────────────────

db/up:
	docker compose up -d
	@echo "Waiting for DB to be healthy..."
	@until docker compose ps | grep -q "healthy"; do sleep 2; done
	@echo "DB ready."

db/down:
	docker compose down

db/push:
	pnpm db:push

db/studio:
	pnpm db:studio

db/seed:
	pnpm db:seed

# Create or promote a superadmin account.
# Usage: make db/create-root email=admin@example.com password=secret
db/create-root:
	ROOT_EMAIL=$(email) ROOT_PASSWORD=$(password) pnpm exec tsx server/scripts/create-superadmin.ts

# Inspect or purge stored embeddings by embedder id.
# Usage: make db/reindex            (list)
#        make db/reindex purge=bge-m3
db/reindex:
	pnpm exec tsx server/scripts/reindex-embeddings.ts $(if $(purge),--purge $(purge),)

# ── Quality ──────────────────────────────────────────────────────────────────

test:
	pnpm test

test/watch:
	pnpm test:watch

# Reseeds agenthub_test, then runs *.itest.ts against it. Requires TEST_DATABASE_URL.
test/integration:
	pnpm test:integration

typecheck:
	pnpm exec tsc --noEmit

lint:
	pnpm lint

# ── Setup ────────────────────────────────────────────────────────────────────

install:
	pnpm install

# Start DB, apply schema, then launch dev server
setup: db/up db/push dev
