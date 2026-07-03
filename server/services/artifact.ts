import { eq } from "drizzle-orm";
import { artifacts, artifactVersions, artifactFiles, artifactMembers, artifactTasks } from "@/server/db/schema";
import type { ArtifactKind, TaskStatus } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";

type OwnerType = "user" | "org" | "department" | "team";
type Visibility = "private" | "group" | "public";

export type CreateArtifactInput = {
  kind: ArtifactKind;
  ownerType: OwnerType;
  ownerId: string;
  title: string;
  slug?: string | null;
  description?: string;
  tags?: string[];
  visibility?: Visibility;
  body: string;
  changelog?: string;
  createdBy: string;
  /** skill only */
  files?: { path: string; content: string; mimeType?: string | null }[];
  /** kit only */
  members?: { memberArtifactId: string; position: number }[];
  /** plan only */
  tasks?: { content: string; status?: TaskStatus; position?: number }[];
};

/**
 * Core artifact creation: artifact row + v1 version + whatever kind-specific
 * relations were passed (files/members/tasks), all in one transaction.
 * Generalizes what server/services/plan.ts's createPlan used to do only for
 * plans — callers (routers, MCP tools) own authorization; this just writes.
 *
 * Not currently wired into skill.ts/kit.ts's own `create` mutations — those
 * keep their inline inserts for now (matches Phase 40's scope: this exists
 * so fork/duplicate and import have one creation path to call, not a
 * mandate to migrate every existing call site in the same phase).
 */
export async function createArtifact(input: CreateArtifactInput, db: DbClient) {
  return db.transaction(async (tx) => {
    const [artifact] = await tx
      .insert(artifacts)
      .values({
        kind: input.kind,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        title: input.title,
        slug: input.slug ?? null,
        description: input.description,
        tags: input.tags ?? [],
        visibility: input.visibility ?? "private",
        createdBy: input.createdBy,
      })
      .returning();

    const [version] = await tx
      .insert(artifactVersions)
      .values({
        artifactId: artifact.id,
        versionNo: 1,
        body: input.body,
        changelog: input.changelog ?? "Initial version",
        createdBy: input.createdBy,
      })
      .returning();

    if (input.files?.length) {
      await tx.insert(artifactFiles).values(
        input.files.map((f) => ({
          artifactVersionId: version.id,
          path: f.path,
          content: f.content,
          mimeType: f.mimeType ?? null,
        })),
      );
    }

    if (input.members?.length) {
      await tx.insert(artifactMembers).values(
        input.members.map((m) => ({
          kitArtifactId: artifact.id,
          memberArtifactId: m.memberArtifactId,
          position: m.position,
        })),
      );
    }

    if (input.tasks?.length) {
      await tx.insert(artifactTasks).values(
        input.tasks.map((t, i) => ({
          artifactId: artifact.id,
          content: t.content,
          status: t.status ?? "todo",
          position: t.position ?? i,
        })),
      );
    }

    const [updated] = await tx
      .update(artifacts)
      .set({ currentVersionId: version.id })
      .where(eq(artifacts.id, artifact.id))
      .returning();

    return updated;
  });
}
