import { and, desc, eq, inArray, lte } from "drizzle-orm";
import {
  artifactComments,
  artifacts,
  artifactVersions,
  auditEvents,
  users,
} from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";
import { canAccessArtifact } from "@/server/auth/access";
import { CommentServiceError, findCollaborationArtifact } from "@/server/services/comment";

type Actor = { userId: string; systemRole: "user" | "superadmin" };
type ActivitySource = "comment" | "version" | "system";

type ActivityCursor = {
  createdAt: string;
  source: ActivitySource;
  sourceId: string;
};

type ActivityActor = {
  id: string;
  name: string | null;
  username: string | null;
} | null;

export type ArtifactActivityItem =
  | {
      id: string;
      source: "comment";
      sourceId: string;
      createdAt: Date;
      actor: ActivityActor;
      comment: {
        body: string | null;
        deletedAt: Date | null;
        source: "ui" | "mcp";
      };
    }
  | {
      id: string;
      source: "version";
      sourceId: string;
      createdAt: Date;
      actor: ActivityActor;
      version: {
        versionNo: number;
        changelog: string | null;
      };
    }
  | {
      id: string;
      source: "system";
      sourceId: string;
      createdAt: Date;
      actor: ActivityActor;
      system: {
        action: string;
        metadata: Record<string, unknown> | null;
      };
    };

function encodeCursor(item: ArtifactActivityItem): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: item.createdAt.toISOString(),
      source: item.source,
      sourceId: item.sourceId,
    } satisfies ActivityCursor),
  ).toString("base64url");
}

function decodeCursor(value?: string): ActivityCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ActivityCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      !["comment", "version", "system"].includes(parsed.source ?? "") ||
      typeof parsed.sourceId !== "string" ||
      Number.isNaN(new Date(parsed.createdAt).getTime())
    ) {
      return null;
    }
    return parsed as ActivityCursor;
  } catch {
    return null;
  }
}

function compareActivity(a: ArtifactActivityItem, b: ArtifactActivityItem): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();
  if (byTime !== 0) return byTime;
  const bySource = a.source.localeCompare(b.source);
  if (bySource !== 0) return bySource;
  return a.sourceId.localeCompare(b.sourceId);
}

function isAfterCursor(item: ArtifactActivityItem, cursor: ActivityCursor): boolean {
  return compareActivity(item, {
    id: "",
    source: cursor.source,
    sourceId: cursor.sourceId,
    createdAt: new Date(cursor.createdAt),
    ...(cursor.source === "comment"
      ? { comment: { body: null, deletedAt: null, source: "ui" as const } }
      : cursor.source === "version"
        ? { version: { versionNo: 0, changelog: null } }
        : { system: { action: "", metadata: null } }),
  } as ArtifactActivityItem) > 0;
}

function activityActor(row: { actorId: string | null; actorName: string | null; actorUsername: string | null }): ActivityActor {
  return row.actorId
    ? { id: row.actorId, name: row.actorName, username: row.actorUsername }
    : null;
}

const SYSTEM_ACTIVITY_ACTIONS = [
  "assignment.assigner.change",
  "assignment.assignee.add",
  "assignment.assignee.remove",
  "assignment.status.change",
  "assignment.priority.change",
  "assignment.due_date.change",
  "project.artifact.add",
  "project.artifact.remove",
] as const;

export async function listArtifactActivity(
  artifactId: string,
  actor: Actor,
  input: { cursor?: string; limit?: number },
  db: DbClient,
) {
  const artifact = await findCollaborationArtifact(artifactId, db);
  if (!(await canAccessArtifact(actor, artifact, db))) {
    throw new CommentServiceError("FORBIDDEN", "You cannot access this artifact.");
  }

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const cursor = decodeCursor(input.cursor);
  if (input.cursor && !cursor) {
    throw new CommentServiceError("BAD_REQUEST", "Invalid activity cursor.");
  }
  const before = cursor ? new Date(cursor.createdAt) : undefined;
  const sourceLimit = limit + 1;

  const [commentRows, versionRows, systemRows] = await Promise.all([
    db
      .select({
        id: artifactComments.id,
        body: artifactComments.body,
        source: artifactComments.source,
        deletedAt: artifactComments.deletedAt,
        createdAt: artifactComments.createdAt,
        actorId: users.id,
        actorName: users.name,
        actorUsername: users.username,
      })
      .from(artifactComments)
      .leftJoin(users, eq(artifactComments.authorId, users.id))
      .where(and(eq(artifactComments.artifactId, artifactId), before ? lte(artifactComments.createdAt, before) : undefined))
      .orderBy(desc(artifactComments.createdAt), desc(artifactComments.id))
      .limit(sourceLimit),
    db
      .select({
        id: artifactVersions.id,
        versionNo: artifactVersions.versionNo,
        changelog: artifactVersions.changelog,
        createdAt: artifactVersions.createdAt,
        actorId: users.id,
        actorName: users.name,
        actorUsername: users.username,
      })
      .from(artifactVersions)
      .leftJoin(users, eq(artifactVersions.createdBy, users.id))
      .where(and(eq(artifactVersions.artifactId, artifactId), before ? lte(artifactVersions.createdAt, before) : undefined))
      .orderBy(desc(artifactVersions.createdAt), desc(artifactVersions.id))
      .limit(sourceLimit),
    db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
        actorId: users.id,
        actorName: users.name,
        actorUsername: users.username,
      })
      .from(auditEvents)
      .leftJoin(users, eq(auditEvents.actorId, users.id))
      .where(
        and(
          eq(auditEvents.targetType, "artifact"),
          eq(auditEvents.targetId, artifactId),
          inArray(auditEvents.action, SYSTEM_ACTIVITY_ACTIONS),
          before ? lte(auditEvents.createdAt, before) : undefined,
        ),
      )
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(sourceLimit),
  ]);

  const all: ArtifactActivityItem[] = [
    ...commentRows.map((row) => ({
      id: `comment:${row.id}`,
      source: "comment" as const,
      sourceId: row.id,
      createdAt: row.createdAt,
      actor: activityActor(row),
      comment: { body: row.body, deletedAt: row.deletedAt, source: row.source },
    })),
    ...versionRows.map((row) => ({
      id: `version:${row.id}`,
      source: "version" as const,
      sourceId: row.id,
      createdAt: row.createdAt,
      actor: activityActor(row),
      version: { versionNo: row.versionNo, changelog: row.changelog },
    })),
    ...systemRows.map((row) => ({
      id: `system:${row.id}`,
      source: "system" as const,
      sourceId: row.id,
      createdAt: row.createdAt,
      actor: activityActor(row),
      system: {
        action: row.action,
        metadata: row.metadata as Record<string, unknown> | null,
      },
    })),
  ].sort(compareActivity);

  const remaining = cursor ? all.filter((item) => isAfterCursor(item, cursor)) : all;
  const items = remaining.slice(0, limit);
  return {
    artifact: { id: artifact.id, kind: artifact.kind, title: artifact.title },
    items,
    nextCursor: remaining.length > limit && items.length ? encodeCursor(items[items.length - 1]!) : null,
  };
}
