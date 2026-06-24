import { eq, and, inArray } from "drizzle-orm";
import type { DbClient } from "@/server/db/types";
import { memberships, teams, departments } from "@/server/db/schema";

export type GroupRef = { groupType: "org" | "department" | "team"; groupId: string };
export type Role = "viewer" | "editor" | "admin";

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };
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

/**
 * The user's highest effective role on a group-owned entity, considering
 * upward inheritance (option A): a role held on an ancestor group applies
 * downward. E.g. an org admin is effectively admin on every dept/team under
 * it. Returns null if the user has no membership anywhere in the chain.
 */
export async function effectiveGroupRole(
  userId: string,
  ownerType: "org" | "department" | "team",
  ownerId: string,
  db: DbClient,
): Promise<Role | null> {
  // Build the ancestor chain for the owning group.
  const chain: GroupRef[] = [{ groupType: ownerType, groupId: ownerId }];
  if (ownerType === "team") {
    const team = await db.query.teams.findFirst({ where: eq(teams.id, ownerId) });
    if (team) {
      chain.push({ groupType: "department", groupId: team.departmentId });
      const dept = await db.query.departments.findFirst({
        where: eq(departments.id, team.departmentId),
      });
      if (dept) chain.push({ groupType: "org", groupId: dept.orgId });
    }
  } else if (ownerType === "department") {
    const dept = await db.query.departments.findFirst({ where: eq(departments.id, ownerId) });
    if (dept) chain.push({ groupType: "org", groupId: dept.orgId });
  }

  const ids = chain.map((c) => c.groupId);
  const rows = await db
    .select({
      groupType: memberships.groupType,
      groupId: memberships.groupId,
      role: memberships.role,
    })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), inArray(memberships.groupId, ids)));

  let best: Role | null = null;
  for (const r of rows) {
    // Match the full (type, id) pair — an id alone can collide across types.
    const inChain = chain.some((c) => c.groupType === r.groupType && c.groupId === r.groupId);
    if (!inChain) continue;
    const role = r.role as Role;
    if (best === null || ROLE_RANK[role] > ROLE_RANK[best]) best = role;
  }
  return best;
}

/**
 * Whether a user may edit/delete a prompt:
 *  - superadmin: always
 *  - user-owned: only the owner
 *  - group-owned: effective role of editor or admin on the owning group
 */
export async function canMutatePrompt(
  user: { userId: string; systemRole: "user" | "superadmin" },
  prompt: { ownerType: "user" | "org" | "department" | "team"; ownerId: string },
  db: DbClient,
): Promise<boolean> {
  if (user.systemRole === "superadmin") return true;
  if (prompt.ownerType === "user") return prompt.ownerId === user.userId;
  const role = await effectiveGroupRole(user.userId, prompt.ownerType, prompt.ownerId, db);
  return role === "editor" || role === "admin";
}
