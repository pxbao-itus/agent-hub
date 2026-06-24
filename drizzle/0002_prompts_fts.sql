-- Full-text search GIN index on prompts (title + description).
-- Tags are filtered separately via the = ANY() operator (no FTS needed).
CREATE INDEX IF NOT EXISTS "prompts_fts_idx" ON "prompts" USING gin(
  to_tsvector('english', "title" || ' ' || coalesce("description", ''))
);
