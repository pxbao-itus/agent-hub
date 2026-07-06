import { inArray, sql } from "drizzle-orm";
import type { DbClient } from "@/server/db/types";
import { getAccessibleGroups, effectiveGroupRole } from "@/server/auth/access";
import { workflowStages } from "@/server/db/schema";

export type GroupType = "org" | "department" | "team";
export type SessionUser = { userId: string; systemRole: "user" | "superadmin" };

/** View-rights follow the same D-016 read cone as group-owned artifacts/projects. */
export async function canViewWorkflow(
  user: SessionUser,
  workflow: { ownerGroupType: GroupType; ownerGroupId: string },
  db: DbClient,
): Promise<boolean> {
  if (user.systemRole === "superadmin") return true;
  const groups = await getAccessibleGroups(user.userId, db);
  return groups.some(
    (g) => g.groupType === workflow.ownerGroupType && g.groupId === workflow.ownerGroupId,
  );
}

/**
 * Manage-rights come entirely from `effectiveGroupRole` on the owning group —
 * same threshold as projects and group-owned artifacts. Optional link to a
 * project (`projectId`) carries no permission implications of its own.
 */
export async function canManageWorkflow(
  user: SessionUser,
  ownerGroupType: GroupType,
  ownerGroupId: string,
  db: DbClient,
): Promise<boolean> {
  if (user.systemRole === "superadmin") return true;
  const role = await effectiveGroupRole(user.userId, ownerGroupType, ownerGroupId, db);
  return role === "editor" || role === "admin";
}

type WorkflowRow = { id: string; ownerGroupType: GroupType; ownerGroupId: string };

/** Batches effectiveGroupRole lookups by unique owning group (not per-row). */
export async function attachWorkflowManageFlags<T extends WorkflowRow>(
  rows: T[],
  user: SessionUser,
  db: DbClient,
): Promise<(T & { canManage: boolean })[]> {
  if (user.systemRole === "superadmin") {
    return rows.map((r) => ({ ...r, canManage: true }));
  }

  const uniqueGroups = new Map<string, { type: GroupType; id: string }>();
  for (const r of rows) {
    uniqueGroups.set(`${r.ownerGroupType}:${r.ownerGroupId}`, { type: r.ownerGroupType, id: r.ownerGroupId });
  }

  const roleByGroup = new Map<string, string | null>();
  await Promise.all(
    [...uniqueGroups.entries()].map(async ([key, g]) => {
      roleByGroup.set(key, await effectiveGroupRole(user.userId, g.type, g.id, db));
    }),
  );

  return rows.map((r) => {
    const role = roleByGroup.get(`${r.ownerGroupType}:${r.ownerGroupId}`);
    return { ...r, canManage: role === "editor" || role === "admin" };
  });
}

/** Batches stage progress (done/total) for a list of workflows into 1 query. */
export async function attachWorkflowProgress<T extends { id: string }>(
  rows: T[],
  db: DbClient,
): Promise<(T & { stageCount: number; doneCount: number })[]> {
  const ids = rows.map((r) => r.id);
  const counts = await db
    .select({
      workflowId: workflowStages.workflowId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${workflowStages.status} = 'done')::int`,
    })
    .from(workflowStages)
    .where(inArray(workflowStages.workflowId, ids))
    .groupBy(workflowStages.workflowId);

  const countMap = new Map(counts.map((c) => [c.workflowId, c]));

  return rows.map((r) => {
    const c = countMap.get(r.id);
    return { ...r, stageCount: c?.total ?? 0, doneCount: c?.done ?? 0 };
  });
}
