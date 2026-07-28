import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import {
  artifactCommentMentions,
  artifactComments,
  artifacts,
  users,
} from "@/server/db/schema";
import type { ArtifactKind, CommentSource } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";
import { canAccessArtifact, canMutatePrompt } from "@/server/auth/access";
import { extractMentionUsernames } from "@/server/lib/username";
import { recordAudit } from "@/server/services/audit";
import { notifyCommentCreated, notifyNewMentions } from "@/server/services/notification";

export type CommentActor = {
  userId: string;
  systemRole: "user" | "superadmin";
};

export type CollaborationArtifact = {
  id: string;
  title: string;
  kind: ArtifactKind;
  ownerType: "user" | "org" | "department" | "team";
  ownerId: string;
  visibility: "private" | "group" | "public";
};

export class CommentServiceError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST",
    message: string,
  ) {
    super(message);
  }
}

function assertCollaborationKind(artifact: Pick<CollaborationArtifact, "kind">): void {
  if (artifact.kind !== "doc" && artifact.kind !== "plan") {
    throw new CommentServiceError("BAD_REQUEST", "Only docs and plans support comments.");
  }
}

function validateBody(body: string): string {
  if (body.length > 20_000) {
    throw new CommentServiceError("BAD_REQUEST", "Comment must be 20,000 characters or fewer.");
  }
  if (!body.trim()) {
    throw new CommentServiceError("BAD_REQUEST", "Comment cannot be empty.");
  }
  return body;
}

export async function findCollaborationArtifact(artifactId: string, db: DbClient): Promise<CollaborationArtifact> {
  const artifact = await db.query.artifacts.findFirst({
    where: eq(artifacts.id, artifactId),
    columns: {
      id: true,
      title: true,
      kind: true,
      ownerType: true,
      ownerId: true,
      visibility: true,
    },
  });
  if (!artifact) throw new CommentServiceError("NOT_FOUND", "Artifact not found.");
  assertCollaborationKind(artifact);
  return artifact;
}

async function requireReadable(
  artifact: CollaborationArtifact,
  actor: CommentActor,
  db: DbClient,
): Promise<void> {
  if (!(await canAccessArtifact(actor, artifact, db))) {
    throw new CommentServiceError("FORBIDDEN", "You cannot access this artifact.");
  }
}

type ResolvedMentions = {
  userIds: string[];
  usernames: string[];
  unresolvedMentions: string[];
};

async function resolveMentions(
  body: string,
  artifact: CollaborationArtifact,
  db: DbClient,
): Promise<ResolvedMentions> {
  const handles = extractMentionUsernames(body);
  if (handles.length > 20) {
    throw new CommentServiceError("BAD_REQUEST", "A comment can mention at most 20 users.");
  }
  if (handles.length === 0) return { userIds: [], usernames: [], unresolvedMentions: [] };

  const rows = await db.query.users.findMany({
    where: inArray(users.username, handles),
    columns: { id: true, username: true, systemRole: true },
  });

  const valid: typeof rows = [];
  for (const user of rows) {
    if (await canAccessArtifact({ userId: user.id, systemRole: user.systemRole }, artifact, db)) {
      valid.push(user);
    }
  }
  const validHandles = new Set(valid.flatMap((user) => (user.username ? [user.username] : [])));
  return {
    userIds: valid.map((user) => user.id),
    usernames: [...validHandles],
    unresolvedMentions: handles.filter((handle) => !validHandles.has(handle)),
  };
}

type CommentCursor = { createdAt: string; id: string };

function decodeCursor(cursor?: string): CommentCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as CommentCursor;
    if (!parsed.id || Number.isNaN(Date.parse(parsed.createdAt))) return null;
    return parsed;
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url");
}

export async function listComments(
  artifact: CollaborationArtifact,
  actor: CommentActor,
  input: { cursor?: string; limit?: number },
  db: DbClient,
) {
  assertCollaborationKind(artifact);
  await requireReadable(artifact, actor, db);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const cursor = decodeCursor(input.cursor);
  const rows = await db.query.artifactComments.findMany({
    where: and(
      eq(artifactComments.artifactId, artifact.id),
      cursor
        ? or(
            lt(artifactComments.createdAt, new Date(cursor.createdAt)),
            and(
              eq(artifactComments.createdAt, new Date(cursor.createdAt)),
              lt(artifactComments.id, cursor.id),
            ),
          )
        : undefined,
    ),
    orderBy: [desc(artifactComments.createdAt), desc(artifactComments.id)],
    limit: limit + 1,
    with: {
      author: { columns: { id: true, name: true, username: true, image: true } },
      mentions: {
        with: { user: { columns: { id: true, name: true, username: true } } },
      },
    },
  });
  const page = rows.slice(0, limit);
  const oldest = page.at(-1);
  return {
    items: page.reverse(),
    nextCursor: rows.length > limit && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null,
  };
}

export async function createComment(
  artifact: CollaborationArtifact,
  input: { body: string },
  actor: CommentActor,
  source: CommentSource,
  db: DbClient,
) {
  assertCollaborationKind(artifact);
  await requireReadable(artifact, actor, db);
  const body = validateBody(input.body);
  const mentions = await resolveMentions(body, artifact, db);

  const comment = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(artifactComments)
      .values({ artifactId: artifact.id, authorId: actor.userId, body, source })
      .returning();
    if (mentions.userIds.length > 0) {
      await tx.insert(artifactCommentMentions).values(
        mentions.userIds.map((userId) => ({ commentId: created.id, userId })),
      );
    }
    await notifyCommentCreated(artifact.id, created.id, mentions.userIds, actor.userId, tx);
    return created;
  });
  return { comment, ...mentions };
}

export async function updateComment(
  commentId: string,
  input: { body: string },
  actor: CommentActor,
  db: DbClient,
) {
  const comment = await db.query.artifactComments.findFirst({
    where: eq(artifactComments.id, commentId),
    with: {
      artifact: true,
      mentions: true,
    },
  });
  if (!comment) throw new CommentServiceError("NOT_FOUND", "Comment not found.");
  assertCollaborationKind(comment.artifact);
  await requireReadable(comment.artifact, actor, db);
  if (comment.deletedAt) throw new CommentServiceError("BAD_REQUEST", "Deleted comments cannot be edited.");
  if (comment.authorId !== actor.userId) {
    throw new CommentServiceError("FORBIDDEN", "Only the comment author can edit it.");
  }

  const body = validateBody(input.body);
  const mentions = await resolveMentions(body, comment.artifact, db);
  const beforeIds = new Set(comment.mentions.map((mention) => mention.userId));
  const afterIds = new Set(mentions.userIds);
  const changedMentions =
    beforeIds.size !== afterIds.size || [...beforeIds].some((id) => !afterIds.has(id));
  if (comment.body === body && !changedMentions) {
    return { comment, changed: false, newMentionUserIds: [], ...mentions };
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(artifactComments)
      .set({ body, updatedAt: new Date() })
      .where(eq(artifactComments.id, commentId))
      .returning();
    await tx.delete(artifactCommentMentions).where(eq(artifactCommentMentions.commentId, commentId));
    if (mentions.userIds.length > 0) {
      await tx.insert(artifactCommentMentions).values(
        mentions.userIds.map((userId) => ({ commentId, userId })),
      );
    }
    const newMentionUserIds = mentions.userIds.filter((id) => !beforeIds.has(id));
    await notifyNewMentions(comment.artifactId, commentId, newMentionUserIds, actor.userId, tx);
    return row;
  });

  return {
    comment: updated,
    changed: true,
    newMentionUserIds: mentions.userIds.filter((id) => !beforeIds.has(id)),
    ...mentions,
  };
}

export async function deleteComment(
  commentId: string,
  actor: CommentActor,
  db: DbClient,
) {
  const comment = await db.query.artifactComments.findFirst({
    where: eq(artifactComments.id, commentId),
    with: { artifact: true },
  });
  if (!comment) throw new CommentServiceError("NOT_FOUND", "Comment not found.");
  assertCollaborationKind(comment.artifact);
  await requireReadable(comment.artifact, actor, db);
  if (comment.deletedAt) return { deleted: false };

  const isAuthor = comment.authorId === actor.userId;
  const canModerate = await canMutatePrompt(actor, comment.artifact, db);
  if (!isAuthor && !canModerate) {
    throw new CommentServiceError("FORBIDDEN", "You cannot delete this comment.");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(artifactComments)
      .set({ body: null, deletedAt: new Date(), deletedBy: actor.userId, updatedAt: new Date() })
      .where(eq(artifactComments.id, commentId));
    await tx.delete(artifactCommentMentions).where(eq(artifactCommentMentions.commentId, commentId));
  });

  if (!isAuthor) {
    await recordAudit(
      {
        actorId: actor.userId,
        action: "comment.moderate.delete",
        targetType: "artifact",
        targetId: comment.artifactId,
        metadata: { commentId, authorId: comment.authorId },
      },
      db,
    );
  }
  return { deleted: true };
}
