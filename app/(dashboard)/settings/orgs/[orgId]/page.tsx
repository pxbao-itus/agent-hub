import { auth } from "@/auth";
import { db } from "@/server/db";
import { orgs, departments, teams, memberships, users } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddMemberForm } from "./add-member-form";
import { CreateDeptForm } from "./create-dept-form";

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
    ? await db.query.teams.findMany({ where: eq(teams.departmentId, depts[0].id) })
    : [];

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

      {/* Departments */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Departments</h2>
        {depts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No departments yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {depts.map((dept) => (
              <Card key={dept.id}>
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm">{dept.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  {isAdmin && (
                    <AddMemberForm groupType="department" groupId={dept.id} label={`Add member to ${dept.name}`} />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {isAdmin && <CreateDeptForm orgId={orgId} />}
      </section>
    </div>
  );
}
