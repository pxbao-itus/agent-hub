import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { orgs, departments, memberships, users } from "@/server/db/schema";
import { eq, and, count } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MemberList } from "@/components/ui/member-list";
import { Breadcrumb } from "../_components/breadcrumb";
import { AddMemberDialog } from "./add-member-dialog";
import { CreateDeptDialog } from "./create-dept-dialog";

const getOrg = cache(async (orgId: string) =>
  db.query.orgs.findFirst({ where: eq(orgs.id, orgId) }),
);

export async function generateMetadata({ params }: { params: Promise<{ orgId: string }> }): Promise<Metadata> {
  const { orgId } = await params;
  const org = await getOrg(orgId);
  return { title: org?.name ?? "Organization" };
}

export default async function OrgDetailPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const org = await getOrg(orgId);
  if (!org) notFound();

  const membership = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.userId, userId),
      eq(memberships.groupType, "org"),
      eq(memberships.groupId, orgId),
    ),
  });
  if (!membership && !isSuperAdmin) notFound();

  const isAdmin = isSuperAdmin || membership?.role === "admin";

  const [deptsWithCount, orgMembers] = await Promise.all([
    db
      .select({
        id: departments.id,
        name: departments.name,
        slug: departments.slug,
        teamCount: count(memberships.id),
      })
      .from(departments)
      .leftJoin(
        memberships,
        and(eq(memberships.groupId, departments.id), eq(memberships.groupType, "department")),
      )
      .where(eq(departments.orgId, orgId))
      .groupBy(departments.id),
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
      .where(and(eq(memberships.groupType, "org"), eq(memberships.groupId, orgId))),
  ]);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Breadcrumb segments={[
          { label: "Organizations", href: "/settings/orgs" },
          { label: org.name },
        ]} />
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{org.name}</h1>
            <p className="text-sm text-muted-foreground font-mono">/{org.slug}</p>
          </div>
          {membership && (
            <Badge variant={membership.role === "admin" ? "default" : "outline"}>
              {membership.role}
            </Badge>
          )}
        </div>
      </div>

      {/* Members */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Members</h2>
            <p className="text-xs text-muted-foreground">{orgMembers.length} member{orgMembers.length !== 1 ? "s" : ""}</p>
          </div>
          {isAdmin && <AddMemberDialog groupType="org" groupId={orgId} />}
        </div>
        <MemberList members={orgMembers} isAdmin={isAdmin} currentUserId={userId} />
      </section>

      {/* Departments */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Departments</h2>
            <p className="text-xs text-muted-foreground">{deptsWithCount.length} department{deptsWithCount.length !== 1 ? "s" : ""}</p>
          </div>
          {isAdmin && <CreateDeptDialog orgId={orgId} orgSlug={org.slug} />}
        </div>
        {deptsWithCount.length === 0 ? (
          <EmptyState
            message="No departments yet."
            action={isAdmin ? <CreateDeptDialog orgId={orgId} orgSlug={org.slug} /> : undefined}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {deptsWithCount.map((dept) => (
              <Link key={dept.id} href={`/settings/orgs/${orgId}/departments/${dept.id}`}>
                <Card className="h-full cursor-pointer transition-colors hover:bg-muted/50">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <CardTitle className="truncate text-sm">{dept.name}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      {dept.teamCount} member{dept.teamCount !== 1 ? "s" : ""} · View teams →
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
