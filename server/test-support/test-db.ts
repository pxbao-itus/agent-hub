import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/server/db/schema";

/**
 * A DbClient wired to TEST_DATABASE_URL, for *.itest.ts integration tests.
 * Never reads DATABASE_URL — so these tests can never accidentally run
 * against dev data even if both vars happen to be set in the environment.
 *
 * Assumes `pnpm db:seed:test` has already reset+seeded the target database
 * (see server/db/seed-test.ts) — run via `pnpm test:integration`.
 */
export function createTestDb() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error("TEST_DATABASE_URL must be set to run integration tests (see server/db/seed-test.ts).");
  }

  const dbName = new URL(connectionString).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `TEST_DATABASE_URL must point at a database whose name ends in "_test" (got "${dbName}").`,
    );
  }

  const pool = new Pool({ connectionString });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
