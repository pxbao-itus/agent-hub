-- Phase 28: Add plan as artifact kind 4, with live task list.

BEGIN;

-- 1. Extend kind CHECK constraint
ALTER TABLE "artifacts" DROP CONSTRAINT "artifacts_kind_check";
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_kind_check"
  CHECK ("kind" IN ('prompt','skill','kit','plan'));

-- 2. Add task_status enum
CREATE TYPE "task_status" AS ENUM ('todo','doing','done');

-- 3. Create artifact_tasks table (live, not versioned)
CREATE TABLE "artifact_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "artifact_id" uuid NOT NULL REFERENCES "artifacts"("id") ON DELETE CASCADE,
  "position" integer NOT NULL DEFAULT 0,
  "content" text NOT NULL,
  "status" task_status NOT NULL DEFAULT 'todo',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "artifact_tasks_artifact_idx" ON "artifact_tasks" ("artifact_id");

COMMIT;
