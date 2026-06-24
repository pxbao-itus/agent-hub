import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { orgs, memberships, departments, teams } from "@/server/db/schema";
import { eq, and, count } from "drizzle-orm";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CreateOrgDialog } from "./create-org-dialog";

export const metadata: Metadata = { title: "Organizations" };

export default async function OrgsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  // Orgs the user belongs to, with department count
  const rows = await db
    .select({
      id: orgs.id,
      name: orgs.name,
      slug: orgs.slug,
      role: memberships.role,
      deptCount: count(departments.id),
    })
    .from(orgs)
    .innerJoin(
      memberships,
      and(
        eq(memberships.groupId, orgs.id),
        eq(memberships.groupType, "org"),
        eq(memberships.userId, userId),
      ),
    )
    .leftJoin(departments, eq(departments.orgId, orgs.id))
    .groupBy(orgs.id, memberships.role);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Organizations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {rows.length === 0 ? "You are not a member of any organization." : `${rows.length} organization${rows.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <CreateOrgDialog />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          message="You are not a member of any organization yet."
          action={<CreateOrgDialog />}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((org) => (
            <Card key={org.id} className="transition-colors hover:bg-muted/30">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <CardTitle className="truncate text-base">{org.name}</CardTitle>
                  </div>
                  <Badge variant={org.role === "admin" ? "default" : "outline"} className="shrink-0">
                    {org.role}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground font-mono">/{org.slug}</p>
                <p className="text-xs text-muted-foreground">
                  {org.deptCount} department{org.deptCount !== 1 ? "s" : ""}
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/settings/orgs/${org.id}`}>Manage</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
