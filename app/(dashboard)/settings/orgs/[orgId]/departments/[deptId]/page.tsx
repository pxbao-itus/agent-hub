import { auth } from "@/auth";
import { db } from "@/server/db";
import { orgs, departments, teams, memberships, users } from "@/server/db/schema";
import { eq, and, count } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MemberList } from "@/components/ui/member-list";
import { Breadcrumb } from "../../../_components/breadcrumb";
import { AddMemberDialog } from "../../add-member-dialog";
import { CreateTeamDialog } from "../../create-team-dialog";

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

  const membership = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.userId, userId),
      eq(memberships.groupType, "org"),
      eq(memberships.groupId, orgId),
    ),
  });
  if (!membership && !isSuperAdmin) notFound();

  const isAdmin = isSuperAdmin || membership?.role === "admin";
  const deptSlugPath = [org.slug, dept.slug].filter(Boolean).join(".");

  const [teamsWithCount, deptMembers] = await Promise.all([
    db
      .select({
        id: teams.id,
        name: teams.name,
        slug: teams.slug,
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
        {dept.slug && <p className="text-sm text-muted-foreground font-mono">/{dept.slug}</p>}
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
              {teamsWithCount.length} team{teamsWithCount.length !== 1 ? "s" : ""}
            </p>
          </div>
          {isAdmin && <CreateTeamDialog departmentId={deptId} deptSlugPath={deptSlugPath} />}
        </div>
        {teamsWithCount.length === 0 ? (
          <EmptyState
            message="No teams yet."
            action={isAdmin ? <CreateTeamDialog departmentId={deptId} deptSlugPath={deptSlugPath} /> : undefined}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {teamsWithCount.map((team) => (
              <Link
                key={team.id}
                href={`/settings/orgs/${orgId}/departments/${deptId}/teams/${team.id}`}
              >
                <Card className="h-full cursor-pointer transition-colors hover:bg-muted/50">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <CardTitle className="truncate text-sm">{team.name}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      {team.memberCount} member{team.memberCount !== 1 ? "s" : ""} · View →
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
