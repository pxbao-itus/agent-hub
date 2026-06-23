import { auth } from "@/auth";
import { db } from "@/server/db";
import { orgs, departments, teams, memberships, users } from "@/server/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddMemberForm } from "./add-member-form";
import { CreateDeptForm } from "./create-dept-form";
import { CreateTeamForm } from "./create-team-form";

export default async function OrgDetailPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await auth();
  const userId = session!.user!.id!;

  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
  if (!org) notFound();

  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const membership = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.userId, userId),
      eq(memberships.groupType, "org"),
      eq(memberships.groupId, orgId),
    ),
  });
  if (!membership && !isSuperAdmin) notFound();

  const isAdmin = isSuperAdmin || membership?.role === "admin";

  const depts = await db.query.departments.findMany({ where: eq(departments.orgId, orgId) });

  const deptIds = depts.map((d) => d.id);
  const allTeams = deptIds.length > 0
    ? await db.query.teams.findMany({ where: inArray(teams.departmentId, deptIds) })
    : [];

  // Group teams by their parent department for O(1) lookup in render.
  const teamsByDept = new Map<string, typeof allTeams>();
  for (const team of allTeams) {
    const list = teamsByDept.get(team.departmentId) ?? [];
    list.push(team);
    teamsByDept.set(team.departmentId, list);
  }

  const orgMembers = await db
    .select({ id: memberships.id, role: memberships.role, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.groupType, "org"), eq(memberships.groupId, orgId)));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{org.name}</h1>
        <p className="text-sm text-muted-foreground">/{org.slug}</p>
      </div>

      {/* Members */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Members</h2>
        <div className="divide-y rounded-md border">
          {orgMembers.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">{m.name ?? m.email}</p>
                <p className="text-xs text-muted-foreground">{m.email}</p>
              </div>
              <span className="rounded-full border px-2 py-0.5 text-xs">{m.role}</span>
            </div>
          ))}
        </div>
        {isAdmin && <AddMemberForm groupType="org" groupId={orgId} />}
      </section>

      {/* Departments → Teams */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Departments</h2>
        {depts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No departments yet.</p>
        ) : (
          <div className="space-y-3">
            {depts.map((dept) => {
              const deptTeams = teamsByDept.get(dept.id) ?? [];
              return (
                <Card key={dept.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{dept.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Teams within this department */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Teams</p>
                      {deptTeams.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No teams yet.</p>
                      ) : (
                        <div className="divide-y rounded-md border">
                          {deptTeams.map((team) => (
                            <div key={team.id} className="flex items-center justify-between px-3 py-2">
                              <span className="text-sm">{team.name}</span>
                              {isAdmin && (
                                <AddMemberForm groupType="team" groupId={team.id} />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {isAdmin && <CreateTeamForm departmentId={dept.id} />}
                    </div>

                    {/* Department-level members */}
                    {isAdmin && (
                      <div className="space-y-2 border-t pt-3">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          Department members
                        </p>
                        <AddMemberForm groupType="department" groupId={dept.id} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {isAdmin && <CreateDeptForm orgId={orgId} />}
      </section>
    </div>
  );
}
