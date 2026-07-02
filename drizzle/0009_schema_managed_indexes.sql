-- Phase 38 (D-019): re-declare two indexes that existed only in raw-SQL
-- migrations (0002 FTS, 0003 slug — both renamed to artifacts_* in 0005) and
-- were therefore invisible to `drizzle-kit push`, so every push-built database
-- (test, fresh deploy) silently lacked them. They now live in schema.ts too;
-- this migration keeps the hand-maintained raw-SQL history (0004-0008 are all
-- hand-written — the drizzle meta/journal has been unused since 0003) a
-- complete, forward-replayable record. IF NOT EXISTS makes it a no-op on
-- databases that already have them (e.g. the dev DB built via the old path).

-- Full-text search over title + description. Expression must match
-- lib/search.ts's runFts() exactly for the planner to use it.
CREATE INDEX IF NOT EXISTS "artifacts_fts_idx" ON "artifacts" USING gin(
  to_tsvector('english', "title" || ' ' || coalesce("description", ''))
);

-- Slug unique per owner scope; unlimited NULL slugs.
CREATE UNIQUE INDEX IF NOT EXISTS "artifacts_owner_slug_uniq"
  ON "artifacts" ("owner_type", "owner_id", "slug")
  WHERE "slug" IS NOT NULL;
