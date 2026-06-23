import { auth } from "@/auth";
import { db } from "@/server/db";
import { orgs, departments, teams, memberships, users } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Breadcrumb } from "../../../../../_components/breadcrumb";
import { AddMemberForm } from "../../../../add-member-form";

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

  // Access: must be org member (access is checked at org level per option A)
  const membership = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.userId, userId),
      eq(memberships.groupType, "org"),
      eq(memberships.groupId, orgId),
    ),
  });
  if (!membership && !isSuperAdmin) notFound();

  const isAdmin = isSuperAdmin || membership?.role === "admin";

  const teamMembers = await db
    .select({ id: memberships.id, role: memberships.role, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.groupType, "team"), eq(memberships.groupId, teamId)));

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Breadcrumb segments={[
          { label: "Organizations", href: "/settings/orgs" },
          { label: org.name, href: `/settings/orgs/${orgId}` },
          { label: dept.name, href: `/settings/orgs/${orgId}/departments/${deptId}` },
          { label: team.name },
        ]} />
        <h1 className="text-2xl font-bold">{team.name}</h1>
        {team.slug && <p className="text-sm text-muted-foreground">/{team.slug}</p>}
      </div>

      {/* Members */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Members</h2>
        <div className="divide-y rounded-md border">
          {teamMembers.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">{m.name ?? m.email}</p>
                <p className="text-xs text-muted-foreground">{m.email}</p>
              </div>
              <span className="rounded-full border px-2 py-0.5 text-xs">{m.role}</span>
            </div>
          ))}
          {teamMembers.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">No members yet.</p>
          )}
        </div>
        {isAdmin && <AddMemberForm groupType="team" groupId={teamId} />}
      </section>
    </div>
  );
}
