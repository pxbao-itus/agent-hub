import { eq, and } from "drizzle-orm";
import { artifactAssignments, artifactWorkItems, users } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";
import type { ArtifactKind, AssignmentPriority, AssignmentStatus } from "@/server/db/schema";
import { canAccessArtifact, canMutatePrompt } from "@/server/auth/access";
import { recordAudit } from "@/server/services/audit";
import { notifyAssignmentChange } from "@/server/services/notification";
import { getVersionAuthorName } from "@/server/lib/version-author";
import { ensureAssignmentSubscription } from "@/server/services/subscription";

export type AssignableArtifact = {
  id: string;
  kind: ArtifactKind;
  ownerType: "user" | "org" | "department" | "team";
  ownerId: string;
  visibility: "private" | "group" | "public";
  createdBy: string | null;
};

type Failure = { ok: false; message: string };

export type WorkItemFields = {
  status: AssignmentStatus;
  priority: AssignmentPriority;
  dueDate: string | null;
};

export const DEFAULT_WORK_ITEM: WorkItemFields = {
  status: "open",
  priority: "normal",
  dueDate: null,
};

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

export async function getWorkItem(artifactId: string, db: DbClient): Promise<WorkItemFields> {
  const row = await db.query.artifactWorkItems.findFirst({
    where: eq(artifactWorkItems.artifactId, artifactId),
    columns: { status: true, priority: true, dueDate: true },
  });
  return row
    ? { status: row.status, priority: row.priority, dueDate: row.dueDate }
    : { ...DEFAULT_WORK_ITEM };
}

export async function getAssignmentDetail(
  artifact: Pick<AssignableArtifact, "id" | "ownerType" | "ownerId" | "createdBy">,
  db: DbClient,
) {
  const [assignments, workItem] = await Promise.all([
    getAssignments(artifact, db),
    getWorkItem(artifact.id, db),
  ]);
  return { ...assignments, workItem };
}

export async function isCurrentAssignee(artifactId: string, userId: string, db: DbClient): Promise<boolean> {
  const row = await db.query.artifactAssignments.findFirst({
    where: and(
      eq(artifactAssignments.artifactId, artifactId),
      eq(artifactAssignments.userId, userId),
      eq(artifactAssignments.role, "assignee"),
    ),
    columns: { id: true },
  });
  return Boolean(row);
}

export async function canUpdateAssignmentStatus(
  actor: { userId: string; systemRole: "user" | "superadmin" },
  artifact: AssignableArtifact,
  db: DbClient,
): Promise<boolean> {
  if (await canMutatePrompt(actor, artifact, db)) return true;
  return isCurrentAssignee(artifact.id, actor.userId, db);
}

function validDueDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export type WorkItemPatch = {
  status?: AssignmentStatus;
  priority?: AssignmentPriority;
  dueDate?: string | null;
};

export type UpdateWorkItemResult =
  | {
      ok: true;
      before: WorkItemFields;
      after: WorkItemFields;
      changedFields: Array<keyof WorkItemFields>;
    }
  | Failure;

export async function updateWorkItem(
  artifact: AssignableArtifact,
  patch: WorkItemPatch,
  actor: { userId: string; systemRole: "user" | "superadmin" },
  db: DbClient,
): Promise<UpdateWorkItemResult> {
  if (artifact.kind !== "doc" && artifact.kind !== "plan") return wrongKind();
  if (patch.dueDate !== undefined && patch.dueDate !== null && !validDueDate(patch.dueDate)) {
    return { ok: false, message: "Due date must be a valid date in YYYY-MM-DD format." };
  }

  const before = await getWorkItem(artifact.id, db);
  const after: WorkItemFields = {
    status: patch.status ?? before.status,
    priority: patch.priority ?? before.priority,
    dueDate: patch.dueDate === undefined ? before.dueDate : patch.dueDate,
  };
  const changedFields = (Object.keys(after) as Array<keyof WorkItemFields>).filter(
    (field) => before[field] !== after[field],
  );
  if (changedFields.length === 0) return { ok: true, before, after, changedFields };

  const canManage = await canMutatePrompt(actor, artifact, db);
  if (changedFields.some((field) => field === "priority" || field === "dueDate") && !canManage) {
    return { ok: false, message: "Only an artifact manager can update priority or due date." };
  }
  if (changedFields.includes("status") && !canManage && !(await isCurrentAssignee(artifact.id, actor.userId, db))) {
    return { ok: false, message: "Only an assignee or artifact manager can update status." };
  }

  await db
    .insert(artifactWorkItems)
    .values({
      artifactId: artifact.id,
      status: after.status,
      priority: after.priority,
      dueDate: after.dueDate,
      updatedBy: actor.userId,
    })
    .onConflictDoUpdate({
      target: artifactWorkItems.artifactId,
      set: {
        status: after.status,
        priority: after.priority,
        dueDate: after.dueDate,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      },
    });

  const { assignerId, assigneeIds } = await getAssignments(artifact, db);
  const sideEffects: Promise<void>[] = [];
  for (const field of changedFields) {
    const action =
      field === "status"
        ? "assignment.status.change"
        : field === "priority"
          ? "assignment.priority.change"
          : "assignment.due_date.change";
    const event =
      field === "status" ? "status.change" : field === "priority" ? "priority.change" : "due_date.change";
    const recipients = field === "status"
      ? [...assigneeIds, ...(assignerId ? [assignerId] : [])]
      : assigneeIds;
    const metadata = { event, oldValue: before[field], newValue: after[field] };
    sideEffects.push(
      recordAudit(
        {
          actorId: actor.userId,
          action,
          targetType: "artifact",
          targetId: artifact.id,
          metadata,
        },
        db,
      ),
      notifyAssignmentChange(artifact.id, recipients, actor.userId, metadata, db),
    );
  }
  await Promise.all(sideEffects);

  return { ok: true, before, after, changedFields };
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
        metadata: { oldAssignerId, oldAssignerName: oldName, newAssignerId, newAssignerName: newName },
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
    ensureAssignmentSubscription(artifact.id, newAssignerId, db),
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
    ensureAssignmentSubscription(artifact.id, userId, db),
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
