import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { artifacts, artifactVersions } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";
import { notifyVersionChange } from "@/server/services/notification";

/**
 * Roll back an artifact to a prior version: copies that version's body into a
 * brand-new version (append-only, no history lost) and repoints currentVersionId.
 * `onVersionCreated` lets a kind copy over version-scoped side-data (e.g. skill
 * bundled files) that lives outside `artifactVersions.body`.
 */
export async function rollbackVersion(
  artifactId: string,
  toVersionNo: number,
  userId: string,
  db: DbClient,
  onVersionCreated?: (newVersionId: string, targetVersionId: string) => Promise<void>,
): Promise<{ newVersionNo: number; newVersionId: string }> {
  const targetVersion = await db.query.artifactVersions.findFirst({
    where: and(eq(artifactVersions.artifactId, artifactId), eq(artifactVersions.versionNo, toVersionNo)),
  });
  if (!targetVersion) throw new TRPCError({ code: "NOT_FOUND", message: "Version not found" });

  const [{ maxNo }] = await db
    .select({ maxNo: sql<number>`coalesce(max(version_no), 0)` })
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, artifactId));

  const [newVersion] = await db
    .insert(artifactVersions)
    .values({
      artifactId,
      versionNo: maxNo + 1,
      body: targetVersion.body,
      changelog: `Rolled back to v${toVersionNo}`,
      createdBy: userId,
    })
    .returning();

  if (onVersionCreated) await onVersionCreated(newVersion.id, targetVersion.id);

  await db
    .update(artifacts)
    .set({ currentVersionId: newVersion.id, updatedAt: new Date() })
    .where(eq(artifacts.id, artifactId));

  await notifyVersionChange(artifactId, newVersion.id, userId, db);

  return { newVersionNo: newVersion.versionNo, newVersionId: newVersion.id };
}
