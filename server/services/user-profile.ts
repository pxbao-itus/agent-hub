import { eq, inArray } from "drizzle-orm";
import {
  accounts,
  departments,
  memberships,
  orgs,
  teams,
  users,
} from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";
import { getAccessibleGroups } from "@/server/auth/access";

export type ProfileViewer = {
  userId: string;
  systemRole: "user" | "superadmin";
};

type DirectMembership = {
  id: string;
  groupType: "org" | "department" | "team";
  groupId: string;
  role: "viewer" | "editor" | "admin";
  createdAt: Date;
};

type OrgFact = { id: string; name: string; image: string | null };
type DepartmentFact = OrgFact & { orgId: string };
type TeamFact = OrgFact & { departmentId: string };

export type ProfileMembership = {
  id: string;
  name: string;
  image: string | null;
  href: string | null;
  direct: {
    membershipId: string;
    role: "viewer" | "editor" | "admin";
    joinedAt: Date;
  } | null;
};

export type ProfileMembershipOrg = ProfileMembership & {
  departments: Array<
    ProfileMembership & {
      teams: ProfileMembership[];
    }
  >;
};

function membershipKey(type: DirectMembership["groupType"], id: string) {
  return `${type}:${id}`;
}

/**
 * Build only the target user's direct groups and their ancestors. A direct
 * Organization membership does not imply that every descendant should be
 * listed as a membership on the profile.
 */
export function buildProfileMembershipTree(input: {
  direct: DirectMembership[];
  orgRows: OrgFact[];
  departmentRows: DepartmentFact[];
  teamRows: TeamFact[];
  openableGroups: Set<string>;
}): ProfileMembershipOrg[] {
  const directByGroup = new Map(
    input.direct.map((row) => [membershipKey(row.groupType, row.groupId), row]),
  );
  const orgById = new Map(input.orgRows.map((row) => [row.id, row]));
  const departmentById = new Map(input.departmentRows.map((row) => [row.id, row]));
  const teamsByDepartment = new Map<string, TeamFact[]>();
  for (const team of input.teamRows) {
    const rows = teamsByDepartment.get(team.departmentId) ?? [];
    rows.push(team);
    teamsByDepartment.set(team.departmentId, rows);
  }

  const relevantDepartmentIds = new Set(
    input.direct
      .filter((row) => row.groupType === "department")
      .map((row) => row.groupId),
  );
  for (const team of input.teamRows) relevantDepartmentIds.add(team.departmentId);

  const relevantOrgIds = new Set(
    input.direct.filter((row) => row.groupType === "org").map((row) => row.groupId),
  );
  for (const departmentId of relevantDepartmentIds) {
    const department = departmentById.get(departmentId);
    if (department) relevantOrgIds.add(department.orgId);
  }

  const directFact = (type: DirectMembership["groupType"], id: string) => {
    const row = directByGroup.get(membershipKey(type, id));
    return row
      ? { membershipId: row.id, role: row.role, joinedAt: row.createdAt }
      : null;
  };
  const href = (type: DirectMembership["groupType"], id: string, parent?: {
    orgId?: string;
    departmentId?: string;
  }) => {
    if (!input.openableGroups.has(membershipKey(type, id))) return null;
    if (type === "org") return `/settings/orgs/${id}`;
    if (type === "department") {
      return `/settings/orgs/${parent?.orgId}/departments/${id}`;
    }
    return `/settings/orgs/${parent?.orgId}/departments/${parent?.departmentId}/teams/${id}`;
  };

  return [...relevantOrgIds]
    .flatMap((orgId) => {
      const org = orgById.get(orgId);
      if (!org) return [];
      const departmentNodes = [...relevantDepartmentIds]
        .flatMap((departmentId) => {
          const department = departmentById.get(departmentId);
          if (!department || department.orgId !== orgId) return [];
          const teamNodes = (teamsByDepartment.get(department.id) ?? [])
            .map((team) => ({
              id: team.id,
              name: team.name,
              image: team.image,
              href: href("team", team.id, {
                orgId,
                departmentId: department.id,
              }),
              direct: directFact("team", team.id),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
          return [{
            id: department.id,
            name: department.name,
            image: department.image,
            href: href("department", department.id, { orgId }),
            direct: directFact("department", department.id),
            teams: teamNodes,
          }];
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return [{
        id: org.id,
        name: org.name,
        image: org.image,
        href: href("org", org.id),
        direct: directFact("org", org.id),
        departments: departmentNodes,
      }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getUserProfile(
  targetUserId: string,
  viewer: ProfileViewer,
  db: DbClient,
) {
  const target = await db.query.users.findFirst({
    where: eq(users.id, targetUserId),
  });
  if (!target) return null;

  const [direct, accessible, providerRows] = await Promise.all([
    db
      .select({
        id: memberships.id,
        groupType: memberships.groupType,
        groupId: memberships.groupId,
        role: memberships.role,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .where(eq(memberships.userId, targetUserId)),
    viewer.systemRole === "superadmin"
      ? Promise.resolve(null)
      : getAccessibleGroups(viewer.userId, db),
    viewer.systemRole === "superadmin"
      ? db
          .select({ provider: accounts.provider })
          .from(accounts)
          .where(eq(accounts.userId, targetUserId))
      : Promise.resolve([]),
  ]);

  const directDepartmentIds = direct
    .filter((row) => row.groupType === "department")
    .map((row) => row.groupId);
  const directTeamIds = direct
    .filter((row) => row.groupType === "team")
    .map((row) => row.groupId);
  const teamRows = directTeamIds.length
    ? await db
        .select({
          id: teams.id,
          name: teams.name,
          image: teams.image,
          departmentId: teams.departmentId,
        })
        .from(teams)
        .where(inArray(teams.id, directTeamIds))
    : [];
  const departmentIds = [
    ...new Set([...directDepartmentIds, ...teamRows.map((row) => row.departmentId)]),
  ];
  const departmentRows = departmentIds.length
    ? await db
        .select({
          id: departments.id,
          name: departments.name,
          image: departments.image,
          orgId: departments.orgId,
        })
        .from(departments)
        .where(inArray(departments.id, departmentIds))
    : [];
  const directOrgIds = direct
    .filter((row) => row.groupType === "org")
    .map((row) => row.groupId);
  const orgIds = [...new Set([...directOrgIds, ...departmentRows.map((row) => row.orgId)])];
  const orgRows = orgIds.length
    ? await db
        .select({ id: orgs.id, name: orgs.name, image: orgs.image })
        .from(orgs)
        .where(inArray(orgs.id, orgIds))
    : [];

  const openableGroups =
    viewer.systemRole === "superadmin"
      ? new Set([
          ...orgRows.map((row) => membershipKey("org", row.id)),
          ...departmentRows.map((row) => membershipKey("department", row.id)),
          ...teamRows.map((row) => membershipKey("team", row.id)),
        ])
      : new Set((accessible ?? []).map((row) => membershipKey(row.groupType, row.groupId)));

  const membershipTree = buildProfileMembershipTree({
    direct,
    orgRows,
    departmentRows,
    teamRows,
    openableGroups,
  });

  return {
    user: {
      id: target.id,
      name: target.name,
      username: target.username,
      email: target.email,
      image: target.image,
      systemRole: target.systemRole,
      createdAt: target.createdAt,
      lastLoginAt: target.lastLoginAt,
    },
    admin:
      viewer.systemRole === "superadmin"
        ? {
            updatedAt: target.updatedAt,
            hasPassword: target.passwordHash !== null,
            authMethods: [
              ...(target.passwordHash ? ["credentials"] : []),
              ...new Set(providerRows.map((row) => row.provider)),
            ],
          }
        : undefined,
    memberships: membershipTree,
    summary: {
      directOrganizations: direct.filter((row) => row.groupType === "org").length,
      directDepartments: direct.filter((row) => row.groupType === "department").length,
      directTeams: direct.filter((row) => row.groupType === "team").length,
    },
  };
}
