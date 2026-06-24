ALTER TABLE "prompts" ADD COLUMN "slug" text;

-- Unique per (owner_type, owner_id, slug), but allow unlimited NULLs
CREATE UNIQUE INDEX "prompts_owner_slug_uniq"
  ON "prompts" ("owner_type", "owner_id", "slug")
  WHERE "slug" IS NOT NULL;
