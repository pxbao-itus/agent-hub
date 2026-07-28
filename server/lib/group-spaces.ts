import type { DbClient } from "@/server/db/types";
import { departments, memberships, orgs, teams } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { resolveAccessibleGroups, type Role } from "@/server/auth/access";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";

export type GroupSpaceType = "org" | "department" | "team";
export type GroupSpaceCapability = "viewable" | "manageable";
export type GroupSpaceRole = Role | "superadmin";

type MembershipRow = {
  groupType: GroupSpaceType;
  groupId: string;
  role: Role;
};

type OrgRow = { id: string; name: string };
type DepartmentRow = { id: string; name: string; orgId: string };
type TeamRow = { id: string; name: string; departmentId: string };

export type GroupSpace = {
  type: GroupSpaceType;
  id: string;
  name: string;
  slugPath: string;
  effectiveRole: GroupSpaceRole;
};

type ResolvedSpace = Omit<GroupSpace, "slugPath">;

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

function membershipKey(type: GroupSpaceType, id: string) {
  return `${type}:${id}`;
}

/**
 * Pure capability resolution used by the DB-backed list function and unit
 * tests. Read access follows D-016's bidirectional cone; mutation authority
 * follows effectiveGroupRole's downward-only inheritance.
 */
export function resolveGroupSpaces(input: {
  systemRole: "user" | "superadmin";
  capability: GroupSpaceCapability;
  memberships: MembershipRow[];
  orgs: OrgRow[];
  departments: DepartmentRow[];
  teams: TeamRow[];
}): ResolvedSpace[] {
  const orgById = new Map(input.orgs.map((row) => [row.id, row]));
  const deptById = new Map(input.departments.map((row) => [row.id, row]));
  const teamById = new Map(input.teams.map((row) => [row.id, row]));
  const membershipByGroup = new Map(
    input.memberships.map((row) => [membershipKey(row.groupType, row.groupId), row.role]),
  );

  const readableKeys =
    input.systemRole === "superadmin"
      ? new Set([
          ...input.orgs.map((row) => membershipKey("org", row.id)),
          ...input.departments.map((row) => membershipKey("department", row.id)),
          ...input.teams.map((row) => membershipKey("team", row.id)),
        ])
      : new Set(
          resolveAccessibleGroups(
            input.memberships,
            new Map(input.teams.map((row) => [row.id, row])),
            new Map(input.departments.map((row) => [row.id, row])),
          ).map((group) => membershipKey(group.groupType, group.groupId)),
        );

  function effectiveRole(type: GroupSpaceType, id: string): Role | null {
    const candidates: Role[] = [];
    const direct = membershipByGroup.get(membershipKey(type, id));
    if (direct) candidates.push(direct);

    if (type === "department") {
      const dept = deptById.get(id);
      const inherited = dept ? membershipByGroup.get(membershipKey("org", dept.orgId)) : undefined;
      if (inherited) candidates.push(inherited);
    }

    if (type === "team") {
      const team = teamById.get(id);
      const dept = team ? deptById.get(team.departmentId) : undefined;
      const deptRole = dept ? membershipByGroup.get(membershipKey("department", dept.id)) : undefined;
      const orgRole = dept ? membershipByGroup.get(membershipKey("org", dept.orgId)) : undefined;
      if (deptRole) candidates.push(deptRole);
      if (orgRole) candidates.push(orgRole);
    }

    return candidates.reduce<Role | null>(
      (best, role) => (best === null || ROLE_RANK[role] > ROLE_RANK[best] ? role : best),
      null,
    );
  }

  const rows: ResolvedSpace[] = [];
  const add = (type: GroupSpaceType, id: string, name: string) => {
    if (input.systemRole === "superadmin") {
      rows.push({ type, id, name, effectiveRole: "superadmin" });
      return;
    }

    const role = effectiveRole(type, id);
    if (input.capability === "manageable") {
      if (role === "editor" || role === "admin") {
        rows.push({ type, id, name, effectiveRole: role });
      }
      return;
    }

    if (readableKeys.has(membershipKey(type, id))) {
      rows.push({ type, id, name, effectiveRole: role ?? "viewer" });
    }
  };

  for (const row of input.orgs) add("org", row.id, row.name);
  for (const row of input.departments) add("department", row.id, row.name);
  for (const row of input.teams) add("team", row.id, row.name);

  return rows;
}

export async function listGroupSpaces(
  identity: { userId: string; systemRole: "user" | "superadmin" },
  capability: GroupSpaceCapability,
  db: DbClient,
): Promise<GroupSpace[]> {
  const [membershipRows, orgRows, departmentRows, teamRows] = await Promise.all([
    db
      .select({
        groupType: memberships.groupType,
        groupId: memberships.groupId,
        role: memberships.role,
      })
      .from(memberships)
      .where(eq(memberships.userId, identity.userId)),
    db.select({ id: orgs.id, name: orgs.name }).from(orgs),
    db
      .select({ id: departments.id, name: departments.name, orgId: departments.orgId })
      .from(departments),
    db
      .select({ id: teams.id, name: teams.name, departmentId: teams.departmentId })
      .from(teams),
  ]);

  const resolved = resolveGroupSpaces({
    systemRole: identity.systemRole,
    capability,
    memberships: membershipRows,
    orgs: orgRows,
    departments: departmentRows,
    teams: teamRows,
  });
  if (resolved.length === 0) return [];

  const slugPaths = await resolveOwnerSlugPaths(
    resolved.map((space) => ({ ownerType: space.type, ownerId: space.id })),
    db,
  );

  return resolved
    .map((space) => ({
      ...space,
      slugPath: slugPaths.get(membershipKey(space.type, space.id)) ?? "",
    }))
    .sort((a, b) => {
      const pathOrder = a.slugPath.localeCompare(b.slugPath);
      if (pathOrder !== 0) return pathOrder;
      return a.type.localeCompare(b.type);
    });
}
