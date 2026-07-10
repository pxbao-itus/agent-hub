import { eq, ne, and } from "drizzle-orm";
import { artifactShares, notifications } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";

/**
 * Fan out an in-app notification to everyone an artifact is directly shared
 * with (per `artifactShares` — not group-membership) when a new version is
 * created. Awaited by the caller, not fire-and-forget: this runs on an
 * already-latency-tolerant write path (a user just clicked Save), so there's
 * no reason to risk the silent-no-op class of bug documented in D-023.
 */
export async function notifyVersionChange(
  artifactId: string,
  artifactVersionId: string,
  actorId: string,
  db: DbClient,
): Promise<void> {
  const recipients = await db
    .select({ userId: artifactShares.userId })
    .from(artifactShares)
    .where(and(eq(artifactShares.artifactId, artifactId), ne(artifactShares.userId, actorId)));

  if (recipients.length === 0) return;

  await db.insert(notifications).values(
    recipients.map((r) => ({
      userId: r.userId,
      artifactId,
      artifactVersionId,
      actorId,
    })),
  );
}

/**
 * Fan out an in-app notification of type 'assignment' (Phase 53) — assigner
 * changed or an assignee was added/removed. `metadata` is a plain bag (mirrors
 * `recordAudit`'s convention) carrying whatever the caller already resolved
 * (ids + name snapshots) so rendering never needs a follow-up join for a user
 * who may since have been renamed or deleted. `recipientIds` may contain
 * duplicates or the actor themselves — both are filtered here so callers
 * don't have to dedupe/exclude at every call site.
 */
export async function notifyAssignmentChange(
  artifactId: string,
  recipientIds: string[],
  actorId: string,
  metadata: Record<string, unknown>,
  db: DbClient,
): Promise<void> {
  const recipients = [...new Set(recipientIds)].filter((id) => id !== actorId);
  if (recipients.length === 0) return;

  await db.insert(notifications).values(
    recipients.map((userId) => ({
      userId,
      type: "assignment" as const,
      artifactId,
      actorId,
      metadata,
    })),
  );
}
