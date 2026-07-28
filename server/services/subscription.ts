import { and, eq } from "drizzle-orm";
import { artifactSubscriptions } from "@/server/db/schema";
import type { ArtifactSubscriptionMode } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";
import { canAccessArtifact } from "@/server/auth/access";
import type { CollaborationArtifact, CommentActor } from "@/server/services/comment";
import { CommentServiceError } from "@/server/services/comment";

export async function getSubscription(userId: string, artifactId: string, db: DbClient) {
  return db.query.artifactSubscriptions.findFirst({
    where: and(
      eq(artifactSubscriptions.userId, userId),
      eq(artifactSubscriptions.artifactId, artifactId),
    ),
  });
}

export async function setSubscription(
  artifact: CollaborationArtifact,
  mode: ArtifactSubscriptionMode,
  actor: CommentActor,
  db: DbClient,
) {
  if (!(await canAccessArtifact(actor, artifact, db))) {
    throw new CommentServiceError("FORBIDDEN", "You cannot access this artifact.");
  }
  const [row] = await db
    .insert(artifactSubscriptions)
    .values({ userId: actor.userId, artifactId: artifact.id, mode })
    .onConflictDoUpdate({
      target: [artifactSubscriptions.userId, artifactSubscriptions.artifactId],
      set: { mode, updatedAt: new Date() },
    })
    .returning();
  return row;
}

/** Assignment auto-follow: never overwrite an explicit mentions/muted choice. */
export async function ensureAssignmentSubscription(
  artifactId: string,
  userId: string,
  db: DbClient,
): Promise<void> {
  await db
    .insert(artifactSubscriptions)
    .values({ userId, artifactId, mode: "all" })
    .onConflictDoNothing();
}

