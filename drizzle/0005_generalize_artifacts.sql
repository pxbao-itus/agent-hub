-- Phase 24: generalize prompt model -> artifact (prompt | skill | kit).
-- Full rename prompts* -> artifacts*, add `kind`, add skill/kit relation tables.

-- 1. Rename tables
ALTER TABLE "prompts" RENAME TO "artifacts";
ALTER TABLE "prompt_versions" RENAME TO "artifact_versions";
ALTER TABLE "prompt_variables" RENAME TO "artifact_variables";
ALTER TABLE "prompt_embeddings" RENAME TO "artifact_embeddings";

-- 2. Rename FK columns
ALTER TABLE "artifact_versions" RENAME COLUMN "prompt_id" TO "artifact_id";
ALTER TABLE "artifact_variables" RENAME COLUMN "prompt_id" TO "artifact_id";
ALTER TABLE "artifact_embeddings" RENAME COLUMN "prompt_version_id" TO "artifact_version_id";

-- 3. Add discriminator column (existing rows -> 'prompt')
ALTER TABLE "artifacts" ADD COLUMN "kind" text NOT NULL DEFAULT 'prompt';
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_kind_check" CHECK ("kind" IN ('prompt','skill','kit'));

-- 4. Rename plain indexes
ALTER INDEX "prompts_owner_idx" RENAME TO "artifacts_owner_idx";
ALTER INDEX "prompts_visibility_idx" RENAME TO "artifacts_visibility_idx";
ALTER INDEX "prompts_owner_slug_uniq" RENAME TO "artifacts_owner_slug_uniq";
ALTER INDEX "prompts_fts_idx" RENAME TO "artifacts_fts_idx";
ALTER INDEX "prompt_versions_prompt_idx" RENAME TO "artifact_versions_artifact_idx";
ALTER INDEX "prompt_embeddings_version_idx" RENAME TO "artifact_embeddings_version_idx";
ALTER INDEX "prompt_embeddings_hnsw_idx" RENAME TO "artifact_embeddings_hnsw_idx";

-- 5. Rename pkey + unique constraints
ALTER TABLE "artifacts" RENAME CONSTRAINT "prompts_pkey" TO "artifacts_pkey";
ALTER TABLE "artifact_versions" RENAME CONSTRAINT "prompt_versions_pkey" TO "artifact_versions_pkey";
ALTER TABLE "artifact_versions" RENAME CONSTRAINT "prompt_versions_prompt_version_uq" TO "artifact_versions_artifact_version_uq";
ALTER TABLE "artifact_variables" RENAME CONSTRAINT "prompt_variables_pkey" TO "artifact_variables_pkey";
ALTER TABLE "artifact_variables" RENAME CONSTRAINT "prompt_variables_prompt_name_uq" TO "artifact_variables_artifact_name_uq";
ALTER TABLE "artifact_embeddings" RENAME CONSTRAINT "prompt_embeddings_pkey" TO "artifact_embeddings_pkey";

-- 6. New relation tables for skill (files) and kit (members) — created empty, unused until Phase 25/27.
CREATE TABLE "artifact_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "artifact_version_id" uuid NOT NULL REFERENCES "artifact_versions"("id") ON DELETE CASCADE,
  "path" text NOT NULL,
  "content" text NOT NULL,
  "mime_type" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "artifact_files_version_path_uq" UNIQUE ("artifact_version_id", "path")
);
CREATE INDEX "artifact_files_version_idx" ON "artifact_files" ("artifact_version_id");

CREATE TABLE "artifact_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kit_artifact_id" uuid NOT NULL REFERENCES "artifacts"("id") ON DELETE CASCADE,
  "member_artifact_id" uuid NOT NULL REFERENCES "artifacts"("id") ON DELETE CASCADE,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "artifact_members_kit_member_uq" UNIQUE ("kit_artifact_id", "member_artifact_id")
);
CREATE INDEX "artifact_members_kit_idx" ON "artifact_members" ("kit_artifact_id");
