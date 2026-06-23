import { auth } from "@/auth";
import { db } from "@/server/db";
import { orgs, memberships } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateOrgForm } from "./create-org-form";

export default async function OrgsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const rows = await db
    .select({ org: orgs })
    .from(orgs)
    .innerJoin(
      memberships,
      and(
        eq(memberships.groupId, orgs.id),
        eq(memberships.groupType, "org"),
        eq(memberships.userId, userId),
      ),
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Organizations</h1>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">You are not a member of any organization yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ org }) => (
            <Card key={org.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{org.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-xs text-muted-foreground">/{org.slug}</p>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/settings/orgs/${org.id}`}>Manage</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="border-t pt-6">
        <h2 className="mb-4 text-lg font-semibold">Create organization</h2>
        <CreateOrgForm />
      </div>
    </div>
  );
}
