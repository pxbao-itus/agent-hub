import { and, eq } from "drizzle-orm";
import {
  artifactAssignments,
  artifacts,
  artifactWorkItems,
  workflows,
  workflowStages,
} from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";
import { artifactAccessCondition, getAccessibleGroups } from "@/server/auth/access";
import type { ProfileViewer } from "@/server/services/user-profile";

export async function listUserResponsibilities(
  targetUserId: string,
  viewer: ProfileViewer,
  input: { limit?: number },
  db: DbClient,
) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const access = await artifactAccessCondition(viewer.userId, viewer.systemRole, db);
  const assignmentRows = await db
    .select({
      id: artifactAssignments.id,
      role: artifactAssignments.role,
      createdAt: artifactAssignments.createdAt,
      artifactId: artifacts.id,
      kind: artifacts.kind,
      title: artifacts.title,
      status: artifactWorkItems.status,
      priority: artifactWorkItems.priority,
      dueDate: artifactWorkItems.dueDate,
    })
    .from(artifactAssignments)
    .innerJoin(artifacts, eq(artifacts.id, artifactAssignments.artifactId))
    .leftJoin(artifactWorkItems, eq(artifactWorkItems.artifactId, artifacts.id))
    .where(and(eq(artifactAssignments.userId, targetUserId), access))
    .orderBy(artifactAssignments.createdAt)
    .limit(limit + 1);

  const accessibleGroups =
    viewer.systemRole === "superadmin"
      ? null
      : new Set(
          (await getAccessibleGroups(viewer.userId, db)).map(
            (group) => `${group.groupType}:${group.groupId}`,
          ),
        );
  const workflowCandidates = await db
    .select({
      stageId: workflowStages.id,
      stageName: workflowStages.name,
      status: workflowStages.status,
      dueDate: workflowStages.dueDate,
      workflowId: workflows.id,
      workflowName: workflows.name,
      ownerGroupType: workflows.ownerGroupType,
      ownerGroupId: workflows.ownerGroupId,
    })
    .from(workflowStages)
    .innerJoin(workflows, eq(workflows.id, workflowStages.workflowId))
    .where(eq(workflowStages.assigneeId, targetUserId))
    .orderBy(workflowStages.updatedAt)
    .limit(limit + 1);
  const workflowRows = workflowCandidates.filter(
    (row) =>
      viewer.systemRole === "superadmin" ||
      accessibleGroups?.has(`${row.ownerGroupType}:${row.ownerGroupId}`),
  );

  return {
    assignments: assignmentRows.slice(0, limit).map((row) => ({
      ...row,
      status: row.status ?? "open",
      priority: row.priority ?? "normal",
      href: `/${row.kind === "doc" ? "docs" : "plans"}/${row.artifactId}`,
    })),
    workflowStages: workflowRows.slice(0, limit).map((row) => ({
      ...row,
      href: `/workflows/${row.workflowId}`,
    })),
    truncated: assignmentRows.length > limit || workflowRows.length > limit,
  };
}
