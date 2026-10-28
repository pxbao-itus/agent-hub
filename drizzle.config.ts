import { defineConfig } from "drizzle-kit";

/**
 * `drizzle-kit push` only — schema.ts is the single source of truth.
 * There is no `drizzle/` migrations directory: the versioned-migration path
 * was abandoned early (the journal only ever tracked 4 of what became 10
 * hand-written migration files) and `drizzle-kit migrate` on a fresh DB
 * silently stopped at that 4th migration, missing every later one. `push` is what dev/test/CI actually exercise, so it's now the only
 * documented path (README, Makefile, Docker deploy instructions).
 */
export default defineConfig({
  schema: "./server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
