import { defineConfig } from "vitest/config";
import { resolve } from "path";

/**
 * Integration tests (*.itest.ts) hit a real Postgres — agenthub_test, via
 * TEST_DATABASE_URL (see server/test-support/test-db.ts). Kept in a separate
 * config from vitest.config.ts so the default `pnpm test` stays DB-free and
 * fast; run these with `pnpm test:integration`, which reseeds first.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.itest.ts"],
    // See vitest.config.ts for why this must be a recursive glob, not a bare
    // "node_modules" string, and why cli/ is excluded outright.
    exclude: ["**/node_modules/**", "**/.next/**", "cli/**"],
    // DB-backed tests share state (the seeded fixtures) — run sequentially
    // to avoid one file's assumptions colliding with another's.
    fileParallelism: false,
    // Repoints DATABASE_URL -> TEST_DATABASE_URL before any test file's
    // module-level `db` imports (e.g. server/mcp/server.ts) resolve.
    setupFiles: ["./server/test-support/integration-setup.ts"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
});
