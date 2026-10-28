import { eq, ne, and } from "drizzle-orm";
import { artifactShares, artifactSubscriptions, notifications } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";

type NotificationDb = Pick<DbClient, "select" | "insert">;

/**
 * Fan out an in-app notification to everyone an artifact is directly shared
 * with (per `artifactShares` — not group-membership) when a new version is
 * created. Awaited by the caller, not fire-and-forget: this runs on an
 * already-latency-tolerant write path (a user just clicked Save), so there's
 * no reason to risk a silent no-op.
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
 * Fan out an in-app notification of type 'assignment' — assigner
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

async function commentRecipientSets(
  artifactId: string,
  mentionUserIds: string[],
  actorId: string,
  includeFollowers: boolean,
  db: NotificationDb,
) {
  const subscriptions = await db
    .select({
      userId: artifactSubscriptions.userId,
      mode: artifactSubscriptions.mode,
    })
    .from(artifactSubscriptions)
    .where(eq(artifactSubscriptions.artifactId, artifactId));
  const modeByUser = new Map(subscriptions.map((row) => [row.userId, row.mode]));

  const mentions = [...new Set(mentionUserIds)].filter(
    (userId) => userId !== actorId && modeByUser.get(userId) !== "muted",
  );
  const mentionSet = new Set(mentions);
  const followers = includeFollowers
    ? subscriptions
        .filter(
          (row) => row.mode === "all" && row.userId !== actorId && !mentionSet.has(row.userId),
        )
        .map((row) => row.userId)
    : [];
  return { mentions, followers };
}

export async function notifyCommentCreated(
  artifactId: string,
  commentId: string,
  mentionUserIds: string[],
  actorId: string,
  db: NotificationDb,
): Promise<void> {
  const { mentions, followers } = await commentRecipientSets(
    artifactId,
    mentionUserIds,
    actorId,
    true,
    db,
  );
  const rows = [
    ...mentions.map((userId) => ({
      userId,
      type: "mention" as const,
      artifactId,
      commentId,
      actorId,
      metadata: { event: "comment.mention" },
    })),
    ...followers.map((userId) => ({
      userId,
      type: "comment" as const,
      artifactId,
      commentId,
      actorId,
      metadata: { event: "comment.create" },
    })),
  ];
  if (rows.length > 0) await db.insert(notifications).values(rows);
}

export async function notifyNewMentions(
  artifactId: string,
  commentId: string,
  mentionUserIds: string[],
  actorId: string,
  db: NotificationDb,
): Promise<void> {
  const { mentions } = await commentRecipientSets(
    artifactId,
    mentionUserIds,
    actorId,
    false,
    db,
  );
  if (mentions.length === 0) return;
  await db.insert(notifications).values(
    mentions.map((userId) => ({
      userId,
      type: "mention" as const,
      artifactId,
      commentId,
      actorId,
      metadata: { event: "comment.mention" },
    })),
  );
}
