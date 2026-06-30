BEGIN;

-- Add 'doc' to artifact kind check constraint
ALTER TABLE "artifacts" DROP CONSTRAINT "artifacts_kind_check";
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_kind_check"
  CHECK ("kind" IN ('prompt','skill','kit','plan','doc'));

-- Generic directed link between any two artifacts
-- relation='doc' for plan→doc; extensible to other relation types without new migrations
CREATE TABLE "artifact_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_artifact_id" uuid NOT NULL REFERENCES "artifacts"("id") ON DELETE CASCADE,
  "target_artifact_id" uuid NOT NULL REFERENCES "artifacts"("id") ON DELETE CASCADE,
  "relation" text NOT NULL DEFAULT 'doc',
  "position" integer NOT NULL DEFAULT 0,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "artifact_links_source_target_relation_uq"
    UNIQUE ("source_artifact_id", "target_artifact_id", "relation")
);

CREATE INDEX "artifact_links_source_idx" ON "artifact_links" ("source_artifact_id");
CREATE INDEX "artifact_links_target_idx" ON "artifact_links" ("target_artifact_id");

COMMIT;
