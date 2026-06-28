import { auth } from "@/auth";
import { db } from "@/server/db";
import { orgs, departments, teams, memberships, users } from "@/server/db/schema";
import { eq, and, count } from "drizzle-orm";
import { notFound } from "next/navigation";
import { MemberList } from "@/components/ui/member-list";
import { Breadcrumb } from "../../../_components/breadcrumb";
import { AddMemberDialog } from "../../add-member-dialog";
import { CreateTeamDialog } from "../../create-team-dialog";
import { TeamCardGrid } from "./team-card-grid";
import { getAccessibleGroups, effectiveGroupRole } from "@/server/auth/access";
import { fetchSubtreePrompts } from "@/server/lib/group-prompts";
import { GroupPromptList } from "../../../_components/group-prompt-list";
import { GroupAvatar } from "@/components/ui/group-avatar";
import { AvatarUrlDialog } from "../../../_components/avatar-url-dialog";

export default async function DeptDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; deptId: string }>;
}) {
  const { orgId, deptId } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const [org, dept] = await Promise.all([
    db.query.orgs.findFirst({ where: eq(orgs.id, orgId) }),
    db.query.departments.findFirst({ where: eq(departments.id, deptId) }),
  ]);
  if (!org || !dept || dept.orgId !== orgId) notFound();

  // Fix: use accessible groups (team-only members can access their dept)
  const accessibleGroups = await getAccessibleGroups(userId, db);
  const accessibleSet = new Set(accessibleGroups.map((g) => `${g.groupType}:${g.groupId}`));
  if (!isSuperAdmin && !accessibleSet.has(`department:${deptId}`)) notFound();

  // isOrgAdmin: can edit/delete the dept itself and manage dept members (org-admin or superadmin)
  const orgMembership = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.userId, userId),
      eq(memberships.groupType, "org"),
      eq(memberships.groupId, orgId),
    ),
  });
  const isOrgAdmin = isSuperAdmin || orgMembership?.role === "admin";

  // isDeptAdmin: can create/edit/delete teams + manage team members (dept-admin, org-admin, superadmin)
  const deptRole = isSuperAdmin ? "admin" : await effectiveGroupRole(userId, "department", deptId, db);
  const isDeptAdmin = deptRole === "admin";

  // isAdmin: backward-compat flag for avatar dialog, AddMemberDialog (dept-level)
  const isAdmin = isDeptAdmin;
  const deptSlugPath = [org.slug, dept.slug].filter(Boolean).join(".");

  const accessibleTeamIds = accessibleGroups
    .filter((g) => g.groupType === "team")
    .map((g) => g.groupId);

  const [allTeamsWithCount, deptMembers, subtreePrompts] = await Promise.all([
    db
      .select({
        id: teams.id,
        name: teams.name,
        slug: teams.slug,
        image: teams.image,
        memberCount: count(memberships.id),
      })
      .from(teams)
      .leftJoin(
        memberships,
        and(eq(memberships.groupId, teams.id), eq(memberships.groupType, "team")),
      )
      .where(eq(teams.departmentId, deptId))
      .groupBy(teams.id),
    db
      .select({
        id: memberships.id,
        role: memberships.role,
        userId: memberships.userId,
        userName: users.name,
        userEmail: users.email,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.groupType, "department"), eq(memberships.groupId, deptId))),
    fetchSubtreePrompts({
      root: { type: "department", id: deptId },
      viewerIsAdmin: isAdmin,
      accessibleGroups,
      db,
    }),
  ]);

  // Non-admins only see teams in their accessible path
  const visibleTeams = isAdmin
    ? allTeamsWithCount
    : allTeamsWithCount.filter((t) => accessibleTeamIds.includes(t.id));

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Breadcrumb
          segments={[
            { label: "Organizations", href: "/settings/orgs" },
            { label: org.name, href: `/settings/orgs/${orgId}` },
            { label: dept.name },
          ]}
        />
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <GroupAvatar image={dept.image} name={dept.name} groupType="department" size="lg" />
            <div>
              <h1 className="text-2xl font-bold">{dept.name}</h1>
              {dept.slug && <p className="text-sm text-muted-foreground font-mono">/{dept.slug}</p>}
            </div>
          </div>
          {isAdmin && (
            <AvatarUrlDialog groupType="department" groupId={deptId} currentImage={dept.image} />
          )}
        </div>
      </div>

      {/* Department-level members */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Members</h2>
            <p className="text-xs text-muted-foreground">
              {deptMembers.length} direct member{deptMembers.length !== 1 ? "s" : ""}
            </p>
          </div>
          {isAdmin && <AddMemberDialog groupType="department" groupId={deptId} />}
        </div>
        <MemberList members={deptMembers} isAdmin={isAdmin} currentUserId={userId} />
      </section>

      {/* Teams */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Teams</h2>
            <p className="text-xs text-muted-foreground">
              {visibleTeams.length} team{visibleTeams.length !== 1 ? "s" : ""}
            </p>
          </div>
          {isAdmin && <CreateTeamDialog departmentId={deptId} deptSlugPath={deptSlugPath} />}
        </div>
        <TeamCardGrid
          teams={visibleTeams}
          orgId={orgId}
          deptId={deptId}
          deptSlugPath={deptSlugPath}
          isAdmin={isAdmin}
        />
      </section>

      {/* Prompts */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Prompts</h2>
          <p className="text-xs text-muted-foreground">
            {subtreePrompts.length} prompt{subtreePrompts.length !== 1 ? "s" : ""} in this department
          </p>
        </div>
        <GroupPromptList items={subtreePrompts} showOwnerLabel />
      </section>
    </div>
  );
}
