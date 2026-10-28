import { inArray, sql } from "drizzle-orm";
import type { DbClient } from "@/server/db/types";
import { getAccessibleGroups, effectiveGroupRole } from "@/server/auth/access";
import { projectArtifacts, projectMembers } from "@/server/db/schema";

export type GroupType = "org" | "department" | "team";
export type SessionUser = { userId: string; systemRole: "user" | "superadmin" };

/** View-rights follow the same read cone as group-owned artifacts. */
export async function canViewProject(
  user: SessionUser,
  project: { ownerGroupType: GroupType; ownerGroupId: string },
  db: DbClient,
): Promise<boolean> {
  if (user.systemRole === "superadmin") return true;
  const groups = await getAccessibleGroups(user.userId, db);
  return groups.some(
    (g) => g.groupType === project.ownerGroupType && g.groupId === project.ownerGroupId,
  );
}

/**
 * Manage-rights for a project come entirely from `effectiveGroupRole` on its
 * owning group — same threshold used for creating/editing group-owned
 * artifacts (skill.ts and the other artifact routers). Project membership itself grants nothing
 * (organizational only).
 */
export async function canManageProject(
  user: SessionUser,
  ownerGroupType: GroupType,
  ownerGroupId: string,
  db: DbClient,
): Promise<boolean> {
  if (user.systemRole === "superadmin") return true;
  const role = await effectiveGroupRole(user.userId, ownerGroupType, ownerGroupId, db);
  return role === "editor" || role === "admin";
}

type ProjectRow = { id: string; ownerGroupType: GroupType; ownerGroupId: string };

/** Batches effectiveGroupRole lookups by unique owning group (not per-row). */
export async function attachProjectManageFlags<T extends ProjectRow>(
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

/** Batches artifact + member counts for a list of projects into 2 queries total. */
export async function attachProjectCounts<T extends { id: string }>(
  rows: T[],
  db: DbClient,
): Promise<(T & { artifactCount: number; memberCount: number })[]> {
  const ids = rows.map((r) => r.id);
  const [artifactCounts, memberCounts] = await Promise.all([
    db
      .select({ projectId: projectArtifacts.projectId, count: sql<number>`count(*)::int` })
      .from(projectArtifacts)
      .where(inArray(projectArtifacts.projectId, ids))
      .groupBy(projectArtifacts.projectId),
    db
      .select({ projectId: projectMembers.projectId, count: sql<number>`count(*)::int` })
      .from(projectMembers)
      .where(inArray(projectMembers.projectId, ids))
      .groupBy(projectMembers.projectId),
  ]);
  const artifactCountMap = new Map(artifactCounts.map((r) => [r.projectId, r.count]));
  const memberCountMap = new Map(memberCounts.map((r) => [r.projectId, r.count]));

  return rows.map((p) => ({
    ...p,
    artifactCount: artifactCountMap.get(p.id) ?? 0,
    memberCount: memberCountMap.get(p.id) ?? 0,
  }));
}
