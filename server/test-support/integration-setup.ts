import "dotenv/config";

/**
 * vitest.integration.config.ts setupFile — runs before each *.itest.ts file's
 * own imports resolve. Unlike access.itest.ts (which takes a DbClient via
 * createTestDb() as an explicit argument), server/mcp/server.ts and other
 * modules import the shared `db` singleton from "@/server/db" at module
 * scope, which is wired to DATABASE_URL, not TEST_DATABASE_URL. Without this,
 * importing those modules in a test would connect to dev data.
 *
 * Repointing DATABASE_URL here — before anything imports "@/server/db" —
 * makes every module-level `db` singleton in the integration lane safe by
 * construction, not dependent on each test file remembering to inject a
 * test-specific client.
 */
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error("TEST_DATABASE_URL must be set to run integration tests (see server/db/seed-test.ts).");
}

const dbName = new URL(testUrl).pathname.replace(/^\//, "");
if (!dbName.endsWith("_test")) {
  throw new Error(
    `TEST_DATABASE_URL must point at a database whose name ends in "_test" (got "${dbName}").`,
  );
}

process.env.DATABASE_URL = testUrl;
