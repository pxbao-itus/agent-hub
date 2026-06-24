import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { prompts, orgs, mcpTokens, memberships, promptVersions } from "@/server/db/schema";
import { eq, and, or, desc, count, sql, isNull, gt } from "drizzle-orm";
import { getAccessibleGroups } from "@/server/auth/access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookText, Building2, Key, Plus } from "lucide-react";

export const metadata = { title: "Dashboard" };

export default async function DashboardHome() {
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  // ── Access condition ───────────────────────────────────────────────────────
  let accessWhere;
  if (!isSuperAdmin) {
    const groups = await getAccessibleGroups(userId, db);
    const groupConditions = groups.map((g) =>
      and(
        eq(prompts.visibility, "group"),
        eq(prompts.ownerType, g.groupType as "org" | "department" | "team"),
        eq(prompts.ownerId, g.groupId),
      ),
    );
    accessWhere = or(
      eq(prompts.visibility, "public"),
      and(eq(prompts.ownerType, "user"), eq(prompts.ownerId, userId)),
      ...(groupConditions.length > 0 ? groupConditions : [sql`false`]),
    );
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const [[{ promptCount }], [{ orgCount }], [{ tokenCount }], recentPrompts] = await Promise.all([
    db.select({ promptCount: count() }).from(prompts).where(accessWhere),
    db
      .select({ orgCount: count() })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.groupType, "org"))),
    db
      .select({ tokenCount: count() })
      .from(mcpTokens)
      .where(and(
        eq(mcpTokens.userId, userId),
        or(isNull(mcpTokens.expiresAt), gt(mcpTokens.expiresAt, new Date())),
      )),
    db.query.prompts.findMany({
      where: accessWhere,
      orderBy: desc(prompts.updatedAt),
      limit: 5,
      with: { versions: { limit: 1, orderBy: desc(promptVersions.versionNo) } },
    }),
  ]);

  const displayName = session!.user?.name ?? session!.user?.email ?? "there";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Welcome back, {displayName.split(" ")[0]}!</h1>
        <p className="text-sm text-muted-foreground mt-1">Here&apos;s what&apos;s happening in your workspace.</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Prompts</CardTitle>
            <BookText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{promptCount}</p>
            <p className="text-xs text-muted-foreground mt-1">accessible to you</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Organizations</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{orgCount}</p>
            <p className="text-xs text-muted-foreground mt-1">you&apos;re a member of</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">MCP Tokens</CardTitle>
            <Key className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{tokenCount}</p>
            <p className="text-xs text-muted-foreground mt-1">active tokens</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href="/prompts/new"><Plus className="h-4 w-4" />New prompt</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/settings/orgs">Manage organizations</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/settings/tokens">Manage tokens</Link>
        </Button>
      </div>

      {/* Recent prompts */}
      {recentPrompts.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent prompts</h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/prompts">View all</Link>
            </Button>
          </div>
          <div className="divide-y rounded-md border">
            {recentPrompts.map((p) => (
              <Link
                key={p.id}
                href={`/prompts/${p.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <div className="space-y-0.5 min-w-0">
                  <p className="text-sm font-medium truncate">{p.title}</p>
                  {p.description && (
                    <p className="text-xs text-muted-foreground truncate">{p.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <Badge variant="outline">{p.visibility}</Badge>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {recentPrompts.length === 0 && promptCount === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No prompts yet.</p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/prompts/new">Create your first prompt</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
