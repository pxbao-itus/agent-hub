import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { orgs, departments, teams, memberships, users } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Breadcrumb } from "../../../_components/breadcrumb";
import { AddMemberForm } from "../../add-member-form";
import { CreateTeamForm } from "../../create-team-form";

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

  const [deptTeams, deptMembers] = await Promise.all([
    db.query.teams.findMany({ where: eq(teams.departmentId, deptId) }),
    db
      .select({ id: memberships.id, role: memberships.role, name: users.name, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.groupType, "department"), eq(memberships.groupId, deptId))),
  ]);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Breadcrumb segments={[
          { label: "Organizations", href: "/settings/orgs" },
          { label: org.name, href: `/settings/orgs/${orgId}` },
          { label: dept.name },
        ]} />
        <h1 className="text-2xl font-bold">{dept.name}</h1>
        {dept.slug && <p className="text-sm text-muted-foreground">/{dept.slug}</p>}
      </div>

      {/* Department members */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Members</h2>
        <div className="divide-y rounded-md border">
          {deptMembers.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">{m.name ?? m.email}</p>
                <p className="text-xs text-muted-foreground">{m.email}</p>
              </div>
              <span className="rounded-full border px-2 py-0.5 text-xs">{m.role}</span>
            </div>
          ))}
          {deptMembers.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">No department-level members.</p>
          )}
        </div>
        {isAdmin && <AddMemberForm groupType="department" groupId={deptId} />}
      </section>

      {/* Teams */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Teams</h2>
        {deptTeams.length === 0 ? (
          <p className="text-sm text-muted-foreground">No teams yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {deptTeams.map((team) => (
              <Link
                key={team.id}
                href={`/settings/orgs/${orgId}/departments/${deptId}/teams/${team.id}`}
              >
                <Card className="h-full transition-colors hover:bg-muted/50 cursor-pointer">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{team.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">View members →</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
        {isAdmin && (
          <CreateTeamForm
            departmentId={deptId}
            deptSlugPath={[org.slug, dept.slug].filter(Boolean).join(".")}
          />
        )}
      </section>
    </div>
  );
}
