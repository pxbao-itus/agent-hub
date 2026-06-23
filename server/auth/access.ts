import { eq, inArray } from "drizzle-orm";
import type { DbClient } from "@/server/db/types";
import { memberships, teams, departments } from "@/server/db/schema";

export type GroupRef = { groupType: "org" | "department" | "team"; groupId: string };
type MembershipRow = { groupType: "org" | "department" | "team"; groupId: string };
type TeamRow = { id: string; departmentId: string };
type DeptRow = { id: string; orgId: string };

/**
 * Pure function — no DB calls. Given a user's direct memberships plus the
 * hierarchy maps, returns every (groupType, groupId) pair the user can access
 * (option A: team member ⇒ implicitly belongs to parent dept and org).
 */
export function resolveAccessibleGroups(
  userMemberships: MembershipRow[],
  teamsMap: Map<string, TeamRow>,
  deptsMap: Map<string, DeptRow>,
): GroupRef[] {
  const seen = new Set<string>();
  const result: GroupRef[] = [];

  function add(g: GroupRef) {
    const key = `${g.groupType}:${g.groupId}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(g);
  }

  for (const m of userMemberships) {
    if (m.groupType === "org") {
      add({ groupType: "org", groupId: m.groupId });
    } else if (m.groupType === "department") {
      add({ groupType: "department", groupId: m.groupId });
      const dept = deptsMap.get(m.groupId);
      if (dept) add({ groupType: "org", groupId: dept.orgId });
    } else if (m.groupType === "team") {
      add({ groupType: "team", groupId: m.groupId });
      const team = teamsMap.get(m.groupId);
      if (team) {
        const dept = deptsMap.get(team.departmentId);
        if (dept) {
          add({ groupType: "department", groupId: dept.id });
          add({ groupType: "org", groupId: dept.orgId });
        }
      }
    }
  }

  return result;
}

/**
 * DB-backed version. Fetches the user's memberships + necessary hierarchy rows,
 * then delegates to the pure function above.
 */
export async function getAccessibleGroups(
  userId: string,
  db: DbClient,
): Promise<GroupRef[]> {
  const userMemberships = await db
    .select({ groupType: memberships.groupType, groupId: memberships.groupId })
    .from(memberships)
    .where(eq(memberships.userId, userId));

  if (userMemberships.length === 0) return [];

  const teamIds = userMemberships
    .filter((m) => m.groupType === "team")
    .map((m) => m.groupId);
  const deptIdsFromMemberships = userMemberships
    .filter((m) => m.groupType === "department")
    .map((m) => m.groupId);

  const [teamRows, deptRowsDirect] = await Promise.all([
    teamIds.length > 0
      ? db
          .select({ id: teams.id, departmentId: teams.departmentId })
          .from(teams)
          .where(inArray(teams.id, teamIds))
      : Promise.resolve([]),
    deptIdsFromMemberships.length > 0
      ? db
          .select({ id: departments.id, orgId: departments.orgId })
          .from(departments)
          .where(inArray(departments.id, deptIdsFromMemberships))
      : Promise.resolve([]),
  ]);

  // Also need dept rows for teams
  const deptIdsFromTeams = teamRows.map((t) => t.departmentId);
  const allDeptIds = [...new Set([...deptIdsFromMemberships, ...deptIdsFromTeams])];
  const deptRows =
    allDeptIds.length > 0
      ? await db
          .select({ id: departments.id, orgId: departments.orgId })
          .from(departments)
          .where(inArray(departments.id, allDeptIds))
      : deptRowsDirect;

  const teamsMap = new Map(teamRows.map((t) => [t.id, t]));
  const deptsMap = new Map(deptRows.map((d) => [d.id, d]));

  return resolveAccessibleGroups(userMemberships, teamsMap, deptsMap);
}
