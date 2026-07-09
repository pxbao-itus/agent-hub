import { eq, inArray, sql } from "drizzle-orm";
import { artifacts, artifactVersions, artifactFiles, artifactMembers, artifactTasks, artifactVariables } from "@/server/db/schema";
import type { ArtifactKind, TaskStatus } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";
import { notifyVersionChange } from "@/server/services/notification";
import { parseVariables } from "@/server/lib/template";

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

export type UpdateArtifactInput = {
  title?: string;
  description?: string | null;
  tags?: string[];
  body?: string;
  changelog?: string;
  /** skill only — replaces the entire file set on the new version (undefined = carry no files, not "keep old ones": the new version needs its own row set). */
  files?: { path: string; content: string; mimeType?: string | null }[];
  updatedBy: string;
};

/**
 * Core artifact update: optional metadata patch + optional new version (body
 * bump, replacing bundled files for skills). Generalizes what doc.ts/plan.ts/
 * skill.ts/kit.ts/prompt.ts's own `update` mutations each duplicate inline —
 * added here so MCP's update_doc/update_plan/update_skill have one path to
 * call (Phase 50) without a mandate to migrate the existing tRPC call sites
 * in the same phase (same reasoning as createArtifact, Phase 40).
 */
export async function updateArtifact(artifactId: string, input: UpdateArtifactInput, db: DbClient) {
  const { updated, newVersionId } = await db.transaction(async (tx) => {
    const metaUpdates: Record<string, unknown> = {};
    if (input.title !== undefined) metaUpdates.title = input.title;
    if (input.description !== undefined) metaUpdates.description = input.description;
    if (input.tags !== undefined) metaUpdates.tags = input.tags;

    let newVersionId: string | undefined;
    if (input.body !== undefined) {
      const [{ maxNo }] = await tx
        .select({ maxNo: sql<number>`coalesce(max(version_no), 0)` })
        .from(artifactVersions)
        .where(eq(artifactVersions.artifactId, artifactId));

      const [version] = await tx
        .insert(artifactVersions)
        .values({
          artifactId,
          versionNo: maxNo + 1,
          body: input.body,
          changelog: input.changelog ?? `Version ${maxNo + 1}`,
          createdBy: input.updatedBy,
        })
        .returning();
      newVersionId = version.id;

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

      metaUpdates.currentVersionId = version.id;
    }

    const [updated] = await tx
      .update(artifacts)
      .set({ ...metaUpdates, updatedAt: new Date() })
      .where(eq(artifacts.id, artifactId))
      .returning();

    return { updated, newVersionId };
  });

  // Outside the transaction, matching rollbackVersion (version.ts): a failure
  // to notify shares shouldn't roll back an otherwise-successful version write.
  if (newVersionId) {
    await notifyVersionChange(artifactId, newVersionId, input.updatedBy, db);
  }

  return updated;
}

/**
 * Sync artifactVariables to whatever {{var}} placeholders currently appear in
 * a prompt's body — prompt only, but lives here (not prompt.ts's router)
 * since MCP's create_prompt/update_prompt (Phase 51) need the same logic and
 * can't import from a route file. Preserves existing variable rows that are
 * still referenced; only adds/removes what changed.
 */
export async function syncVariables(db: DbClient, artifactId: string, body: string) {
  const names = parseVariables(body);
  const existing = await db.query.artifactVariables.findMany({
    where: eq(artifactVariables.artifactId, artifactId),
  });
  const existingNames = new Set(existing.map((v) => v.name));

  const toDelete = existing.filter((v) => !names.includes(v.name)).map((v) => v.id);
  if (toDelete.length > 0) {
    await db.delete(artifactVariables).where(inArray(artifactVariables.id, toDelete));
  }

  const toAdd = names.filter((n) => !existingNames.has(n));
  if (toAdd.length > 0) {
    await db.insert(artifactVariables).values(toAdd.map((name) => ({ artifactId, name })));
  }
}
