-- Phase 29: Per-user artifact sharing (viewer/editor roles).

BEGIN;

-- 1. share_role enum
CREATE TYPE "share_role" AS ENUM ('viewer', 'editor');

-- 2. artifact_shares table
CREATE TABLE "artifact_shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "artifact_id" uuid NOT NULL REFERENCES "artifacts"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" share_role NOT NULL,
  "granted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "artifact_shares_artifact_user_uq" UNIQUE ("artifact_id", "user_id")
);
CREATE INDEX "artifact_shares_user_idx" ON "artifact_shares" ("user_id");
CREATE INDEX "artifact_shares_artifact_idx" ON "artifact_shares" ("artifact_id");

COMMIT;
