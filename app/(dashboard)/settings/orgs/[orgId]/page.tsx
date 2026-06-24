import Link from "next/link";
import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { orgs, departments, memberships, users } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Breadcrumb } from "../_components/breadcrumb";
import { AddMemberForm } from "./add-member-form";
import { CreateDeptForm } from "./create-dept-form";

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

  const [depts, orgMembers] = await Promise.all([
    db.query.departments.findMany({ where: eq(departments.orgId, orgId) }),
    db
      .select({ id: memberships.id, role: memberships.role, name: users.name, email: users.email })
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
          {orgMembers.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">No members yet.</p>
          )}
        </div>
        {isAdmin && <AddMemberForm groupType="org" groupId={orgId} />}
      </section>

      {/* Departments */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Departments</h2>
        {depts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No departments yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {depts.map((dept) => (
              <Link key={dept.id} href={`/settings/orgs/${orgId}/departments/${dept.id}`}>
                <Card className="h-full transition-colors hover:bg-muted/50 cursor-pointer">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{dept.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">View teams & members →</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
        {isAdmin && <CreateDeptForm orgId={orgId} orgSlug={org.slug} />}
      </section>
    </div>
  );
}
