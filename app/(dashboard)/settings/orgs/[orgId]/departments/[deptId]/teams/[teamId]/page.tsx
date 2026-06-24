import { auth } from "@/auth";
import { db } from "@/server/db";
import { orgs, departments, teams, memberships, users } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { MemberList } from "@/components/ui/member-list";
import { Breadcrumb } from "../../../../../_components/breadcrumb";
import { AddMemberDialog } from "../../../../add-member-dialog";
import { getAccessibleGroups } from "@/server/auth/access";
import { fetchSubtreePrompts } from "@/server/lib/group-prompts";
import { GroupPromptList } from "../../../../../_components/group-prompt-list";

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; deptId: string; teamId: string }>;
}) {
  const { orgId, deptId, teamId } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const [org, dept, team] = await Promise.all([
    db.query.orgs.findFirst({ where: eq(orgs.id, orgId) }),
    db.query.departments.findFirst({ where: eq(departments.id, deptId) }),
    db.query.teams.findFirst({ where: eq(teams.id, teamId) }),
  ]);
  if (!org || !dept || !team || dept.orgId !== orgId || team.departmentId !== deptId) notFound();

  // Fix: use accessible groups (team member can access their own team page)
  const accessibleGroups = await getAccessibleGroups(userId, db);
  const accessibleSet = new Set(accessibleGroups.map((g) => `${g.groupType}:${g.groupId}`));
  if (!isSuperAdmin && !accessibleSet.has(`team:${teamId}`)) notFound();

  // isAdmin requires direct org-level admin membership (or superadmin)
  const orgMembership = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.userId, userId),
      eq(memberships.groupType, "org"),
      eq(memberships.groupId, orgId),
    ),
  });
  const isAdmin = isSuperAdmin || orgMembership?.role === "admin";

  const [teamMembers, teamPrompts] = await Promise.all([db
    .select({
      id: memberships.id,
      role: memberships.role,
      userId: memberships.userId,
      userName: users.name,
      userEmail: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.groupType, "team"), eq(memberships.groupId, teamId))),
  fetchSubtreePrompts({
    root: { type: "team", id: teamId },
    viewerIsAdmin: isAdmin,
    accessibleGroups,
    db,
  }),
]);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Breadcrumb
          segments={[
            { label: "Organizations", href: "/settings/orgs" },
            { label: org.name, href: `/settings/orgs/${orgId}` },
            { label: dept.name, href: `/settings/orgs/${orgId}/departments/${deptId}` },
            { label: team.name },
          ]}
        />
        <h1 className="text-2xl font-bold">{team.name}</h1>
        {team.slug && <p className="text-sm text-muted-foreground font-mono">/{team.slug}</p>}
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Members</h2>
            <p className="text-xs text-muted-foreground">
              {teamMembers.length} member{teamMembers.length !== 1 ? "s" : ""}
            </p>
          </div>
          {isAdmin && <AddMemberDialog groupType="team" groupId={teamId} />}
        </div>
        <MemberList members={teamMembers} isAdmin={isAdmin} currentUserId={userId} />
      </section>

      {/* Prompts */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Prompts</h2>
          <p className="text-xs text-muted-foreground">
            {teamPrompts.length} prompt{teamPrompts.length !== 1 ? "s" : ""} in this team
          </p>
        </div>
        <GroupPromptList items={teamPrompts} showOwnerLabel={false} />
      </section>
    </div>
  );
}
