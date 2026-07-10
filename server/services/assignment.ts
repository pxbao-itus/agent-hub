import { eq, and } from "drizzle-orm";
import { artifactAssignments, users } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";
import type { ArtifactKind } from "@/server/db/schema";
import { canAccessArtifact } from "@/server/auth/access";
import { recordAudit } from "@/server/services/audit";
import { notifyAssignmentChange } from "@/server/services/notification";
import { getVersionAuthorName } from "@/server/lib/version-author";

export type AssignableArtifact = {
  id: string;
  kind: ArtifactKind;
  ownerType: "user" | "org" | "department" | "team";
  ownerId: string;
  visibility: "private" | "group" | "public";
  createdBy: string | null;
};

type Failure = { ok: false; message: string };

function wrongKind(): Failure {
  return { ok: false, message: "Only docs and plans support assignment." };
}

/**
 * Effective assigner for a doc/plan: an explicit override row (set via
 * setAssigner), else the owner-user, else `createdBy` for group-owned
 * artifacts (chosen so existing docs/plans need no backfill — see
 * plans/53-doc-plan-assignment.md §2.2).
 */
export async function resolveAssigner(
  artifact: Pick<AssignableArtifact, "id" | "ownerType" | "ownerId" | "createdBy">,
  db: DbClient,
): Promise<string | null> {
  const [override] = await db
    .select({ userId: artifactAssignments.userId })
    .from(artifactAssignments)
    .where(and(eq(artifactAssignments.artifactId, artifact.id), eq(artifactAssignments.role, "assigner")));
  if (override) return override.userId;
  return artifact.ownerType === "user" ? artifact.ownerId : artifact.createdBy;
}

export async function getAssignments(
  artifact: Pick<AssignableArtifact, "id" | "ownerType" | "ownerId" | "createdBy">,
  db: DbClient,
): Promise<{ assignerId: string | null; assigneeIds: string[] }> {
  const [assignerId, assigneeRows] = await Promise.all([
    resolveAssigner(artifact, db),
    db
      .select({ userId: artifactAssignments.userId })
      .from(artifactAssignments)
      .where(and(eq(artifactAssignments.artifactId, artifact.id), eq(artifactAssignments.role, "assignee"))),
  ]);
  return { assignerId, assigneeIds: assigneeRows.map((r) => r.userId) };
}

/**
 * Assignment is orthogonal to read/share permissions (D per plan §7): it
 * never grants visibility, so the target must already be able to view the
 * artifact (public / owner / group member / shared) before they can be
 * assigned to it.
 */
async function requireTargetCanView(userId: string, artifact: AssignableArtifact, db: DbClient): Promise<Failure | null> {
  const target = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { id: true, systemRole: true } });
  if (!target) return { ok: false, message: `User '${userId}' not found.` };
  const canSee = await canAccessArtifact({ userId: target.id, systemRole: target.systemRole }, artifact, db);
  if (!canSee) {
    return {
      ok: false,
      message: "Cannot assign: that user doesn't have access to this artifact yet — share it with them first.",
    };
  }
  return null;
}

export type SetAssignerResult = { ok: true; oldAssignerId: string | null; changed: boolean } | Failure;

/**
 * Replace the assigner override — at most one row per artifact (enforced by
 * `artifact_assignments_one_assigner_uniq`), so this is delete-then-insert in
 * a transaction rather than an upsert keyed on user. Mutates + audits +
 * notifies in one call so the tRPC router (UI) and the MCP tool get
 * identical behavior for free, instead of each re-implementing it.
 */
export async function setAssigner(
  artifact: AssignableArtifact,
  newAssignerId: string,
  actorId: string,
  db: DbClient,
): Promise<SetAssignerResult> {
  if (artifact.kind !== "doc" && artifact.kind !== "plan") return wrongKind();
  const viewFailure = await requireTargetCanView(newAssignerId, artifact, db);
  if (viewFailure) return viewFailure;

  const oldAssignerId = await resolveAssigner(artifact, db);
  if (oldAssignerId === newAssignerId) {
    return { ok: true, oldAssignerId, changed: false };
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(artifactAssignments)
      .where(and(eq(artifactAssignments.artifactId, artifact.id), eq(artifactAssignments.role, "assigner")));
    await tx.insert(artifactAssignments).values({
      artifactId: artifact.id,
      userId: newAssignerId,
      role: "assigner",
      assignedBy: actorId,
    });
  });

  const [oldName, newName] = await Promise.all([
    getVersionAuthorName(oldAssignerId, db),
    getVersionAuthorName(newAssignerId, db),
  ]);

  const recipients = [newAssignerId, ...(oldAssignerId ? [oldAssignerId] : [])];
  await Promise.all([
    recordAudit(
      {
        actorId,
        action: "assignment.assigner.change",
        targetType: "artifact",
        targetId: artifact.id,
        metadata: { oldAssignerId, newAssignerId },
      },
      db,
    ),
    notifyAssignmentChange(
      artifact.id,
      recipients,
      actorId,
      { event: "assigner.change", oldAssignerId, oldAssignerName: oldName, newAssignerId, newAssignerName: newName },
      db,
    ),
  ]);

  return { ok: true, oldAssignerId, changed: true };
}

export type AddAssigneeResult = { ok: true; alreadyAssigned: boolean } | Failure;

export async function addAssignee(
  artifact: AssignableArtifact,
  userId: string,
  actorId: string,
  db: DbClient,
): Promise<AddAssigneeResult> {
  if (artifact.kind !== "doc" && artifact.kind !== "plan") return wrongKind();
  const viewFailure = await requireTargetCanView(userId, artifact, db);
  if (viewFailure) return viewFailure;

  const [row] = await db
    .insert(artifactAssignments)
    .values({ artifactId: artifact.id, userId, role: "assignee", assignedBy: actorId })
    .onConflictDoNothing({
      target: [artifactAssignments.artifactId, artifactAssignments.userId, artifactAssignments.role],
    })
    .returning();

  if (!row) return { ok: true, alreadyAssigned: true };

  const [name, assignerId] = await Promise.all([getVersionAuthorName(userId, db), resolveAssigner(artifact, db)]);

  const recipients = [userId, ...(assignerId ? [assignerId] : [])];
  await Promise.all([
    recordAudit(
      {
        actorId,
        action: "assignment.assignee.add",
        targetType: "artifact",
        targetId: artifact.id,
        metadata: { userId, userName: name },
      },
      db,
    ),
    notifyAssignmentChange(artifact.id, recipients, actorId, { event: "assignee.add", userId, userName: name }, db),
  ]);

  return { ok: true, alreadyAssigned: false };
}

export type RemoveAssigneeResult = { ok: true; removed: boolean } | Failure;

/**
 * No target-view-access check here (unlike setAssigner/addAssignee):
 * removing someone doesn't require they still have access — that access may
 * have been revoked separately, and removal should always be possible.
 */
export async function removeAssignee(
  artifact: AssignableArtifact,
  userId: string,
  actorId: string,
  db: DbClient,
): Promise<RemoveAssigneeResult> {
  if (artifact.kind !== "doc" && artifact.kind !== "plan") return wrongKind();

  const deleted = await db
    .delete(artifactAssignments)
    .where(
      and(
        eq(artifactAssignments.artifactId, artifact.id),
        eq(artifactAssignments.userId, userId),
        eq(artifactAssignments.role, "assignee"),
      ),
    )
    .returning();

  if (deleted.length === 0) return { ok: true, removed: false };

  const [name, assignerId] = await Promise.all([getVersionAuthorName(userId, db), resolveAssigner(artifact, db)]);

  const recipients = [userId, ...(assignerId ? [assignerId] : [])];
  await Promise.all([
    recordAudit(
      {
        actorId,
        action: "assignment.assignee.remove",
        targetType: "artifact",
        targetId: artifact.id,
        metadata: { userId, userName: name },
      },
      db,
    ),
    notifyAssignmentChange(artifact.id, recipients, actorId, { event: "assignee.remove", userId, userName: name }, db),
  ]);

  return { ok: true, removed: true };
}
