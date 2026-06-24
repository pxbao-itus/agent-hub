import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { orgs, departments, memberships, users } from "@/server/db/schema";
import { eq, and, count } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { MemberList } from "@/components/ui/member-list";
import { Breadcrumb } from "../_components/breadcrumb";
import { AddMemberDialog } from "./add-member-dialog";
import { CreateDeptDialog } from "./create-dept-dialog";
import { DeptCardGrid } from "./dept-card-grid";
import { getAccessibleGroups } from "@/server/auth/access";

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

  // Fix: use accessible groups for access check (team-only members can access)
  const accessibleGroups = await getAccessibleGroups(userId, db);
  const accessibleSet = new Set(accessibleGroups.map((g) => `${g.groupType}:${g.groupId}`));
  if (!isSuperAdmin && !accessibleSet.has(`org:${orgId}`)) notFound();

  // isAdmin requires direct org-level admin membership (or superadmin)
  const orgMembership = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.userId, userId),
      eq(memberships.groupType, "org"),
      eq(memberships.groupId, orgId),
    ),
  });
  const isAdmin = isSuperAdmin || orgMembership?.role === "admin";

  const accessibleDeptIds = accessibleGroups
    .filter((g) => g.groupType === "department")
    .map((g) => g.groupId);

  const [allDeptsWithCount, orgMembers] = await Promise.all([
    db
      .select({
        id: departments.id,
        name: departments.name,
        slug: departments.slug,
        memberCount: count(memberships.id),
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

  // Non-admins only see depts in their accessible path
  const visibleDepts = isAdmin
    ? allDeptsWithCount
    : allDeptsWithCount.filter((d) => accessibleDeptIds.includes(d.id));

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Breadcrumb
          segments={[
            { label: "Organizations", href: "/settings/orgs" },
            { label: org.name },
          ]}
        />
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{org.name}</h1>
            <p className="text-sm text-muted-foreground font-mono">/{org.slug}</p>
          </div>
          {orgMembership && (
            <Badge variant={orgMembership.role === "admin" ? "default" : "outline"}>
              {orgMembership.role}
            </Badge>
          )}
        </div>
      </div>

      {/* Members */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Members</h2>
            <p className="text-xs text-muted-foreground">
              {orgMembers.length} member{orgMembers.length !== 1 ? "s" : ""}
            </p>
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
            <p className="text-xs text-muted-foreground">
              {visibleDepts.length} department{visibleDepts.length !== 1 ? "s" : ""}
            </p>
          </div>
          {isAdmin && <CreateDeptDialog orgId={orgId} orgSlug={org.slug} />}
        </div>
        <DeptCardGrid depts={visibleDepts} orgId={orgId} orgSlug={org.slug} isAdmin={isAdmin} />
      </section>
    </div>
  );
}
