import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, orgs, mcpTokens, memberships, artifactFavorites } from "@/server/db/schema";
import { eq, and, desc, count, isNull, gt, or } from "drizzle-orm";
import { artifactAccessCondition } from "@/server/auth/access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookText, Wrench, Package, ClipboardList, FileText, Building2, Key, Plus, Sparkles, Flame, Star } from "lucide-react";

export const metadata = { title: "Dashboard" };

const KIND_ICON: Record<string, React.ElementType> = {
  prompt: BookText,
  skill: Wrench,
  kit: Package,
  plan: ClipboardList,
  doc: FileText,
};
const KIND_HREF: Record<string, string> = {
  prompt: "/prompts",
  skill: "/skills",
  kit: "/kits",
  plan: "/plans",
  doc: "/docs",
};

export default async function DashboardHome() {
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  // ── Access condition ───────────────────────────────────────────────────────
  const accessWhere = await artifactAccessCondition(userId, isSuperAdmin ? "superadmin" : "user", db);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const [[{ promptCount }], [{ skillCount }], [{ kitCount }], [{ planCount }], [{ docCount }], [{ orgCount }], [{ tokenCount }], recentActivity, mostUsed, favorites] = await Promise.all([
    db.select({ promptCount: count() }).from(artifacts).where(and(eq(artifacts.kind, "prompt"), accessWhere)),
    db.select({ skillCount: count() }).from(artifacts).where(and(eq(artifacts.kind, "skill"), accessWhere)),
    db.select({ kitCount: count() }).from(artifacts).where(and(eq(artifacts.kind, "kit"), accessWhere)),
    db.select({ planCount: count() }).from(artifacts).where(and(eq(artifacts.kind, "plan"), accessWhere)),
    db.select({ docCount: count() }).from(artifacts).where(and(eq(artifacts.kind, "doc"), accessWhere)),
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
    db.query.artifacts.findMany({
      where: accessWhere,
      orderBy: desc(artifacts.updatedAt),
      limit: 8,
      columns: { id: true, kind: true, title: true, description: true, visibility: true },
    }),
    db.query.artifacts.findMany({
      where: and(accessWhere, gt(artifacts.fetchCount, 0)),
      orderBy: desc(artifacts.fetchCount),
      limit: 5,
      columns: { id: true, kind: true, title: true, fetchCount: true },
    }),
    db
      .select({ id: artifacts.id, kind: artifacts.kind, title: artifacts.title })
      .from(artifactFavorites)
      .innerJoin(artifacts, eq(artifacts.id, artifactFavorites.artifactId))
      .where(and(eq(artifactFavorites.userId, userId), accessWhere))
      .orderBy(desc(artifactFavorites.createdAt))
      .limit(10),
  ]);

  const totalArtifacts = promptCount + skillCount + kitCount + planCount + docCount;
  const displayName = session!.user?.name ?? session!.user?.email ?? "there";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Welcome back, {displayName.split(" ")[0]}!</h1>
        <p className="text-sm text-muted-foreground mt-1">Here&apos;s what&apos;s happening in your workspace.</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between px-4 pt-4 pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Prompts</CardTitle>
            <BookText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-3xl font-bold">{promptCount}</p>
            <p className="text-xs text-muted-foreground mt-1">accessible to you</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between px-4 pt-4 pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Skills</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-3xl font-bold">{skillCount}</p>
            <p className="text-xs text-muted-foreground mt-1">accessible to you</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between px-4 pt-4 pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Kits</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-3xl font-bold">{kitCount}</p>
            <p className="text-xs text-muted-foreground mt-1">accessible to you</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between px-4 pt-4 pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Plans</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-3xl font-bold">{planCount}</p>
            <p className="text-xs text-muted-foreground mt-1">accessible to you</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between px-4 pt-4 pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Docs</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-3xl font-bold">{docCount}</p>
            <p className="text-xs text-muted-foreground mt-1">accessible to you</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between px-4 pt-4 pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Organizations</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-3xl font-bold">{orgCount}</p>
            <p className="text-xs text-muted-foreground mt-1">you&apos;re a member of</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between px-4 pt-4 pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">MCP Tokens</CardTitle>
            <Key className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
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
          <Link href="/skills/new"><Plus className="h-4 w-4" />New skill</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/kits/new"><Plus className="h-4 w-4" />New kit</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/plans/new"><Plus className="h-4 w-4" />New plan</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/docs/new"><Plus className="h-4 w-4" />New doc</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/settings/orgs">Manage organizations</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/settings/tokens">Manage tokens</Link>
        </Button>
      </div>

      {/* Favorites — starred via FavoriteButton on the detail page */}
      {favorites.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-1.5">
            <Star className="h-4 w-4 text-muted-foreground" />
            Favorites
          </h2>
          <div className="divide-y rounded-md border">
            {favorites.map((a) => {
              const Icon = KIND_ICON[a.kind] ?? BookText;
              const href = `${KIND_HREF[a.kind] ?? "/prompts"}/${a.id}`;
              return (
                <Link
                  key={a.id}
                  href={href}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="text-sm font-medium truncate flex-1">{a.title}</p>
                  <Badge variant="secondary" className="text-[10px] shrink-0">{a.kind}</Badge>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Most used — pulled via MCP; see server/mcp/server.ts's bumpUsage() */}
      {mostUsed.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-1.5">
            <Flame className="h-4 w-4 text-muted-foreground" />
            Most used
          </h2>
          <div className="divide-y rounded-md border">
            {mostUsed.map((a) => {
              const Icon = KIND_ICON[a.kind] ?? BookText;
              const href = `${KIND_HREF[a.kind] ?? "/prompts"}/${a.id}`;
              return (
                <Link
                  key={a.id}
                  href={href}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="text-sm font-medium truncate flex-1">{a.title}</p>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {a.fetchCount} use{a.fetchCount === 1 ? "" : "s"}
                  </Badge>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Recent activity */}
      {recentActivity.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Recent activity</h2>
          <div className="divide-y rounded-md border">
            {recentActivity.map((a) => {
              const Icon = KIND_ICON[a.kind] ?? BookText;
              const href = `${KIND_HREF[a.kind] ?? "/prompts"}/${a.id}`;
              return (
                <Link
                  key={a.id}
                  href={href}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{a.title}</p>
                    {a.description && (
                      <p className="text-xs text-muted-foreground truncate">{a.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <Badge variant="secondary" className="text-[10px]">{a.kind}</Badge>
                    <Badge variant="outline" className="text-[10px]">{a.visibility}</Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Onboarding — first run, nothing accessible yet */}
      {totalArtifacts === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center space-y-4">
          <Sparkles className="mx-auto h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-medium">Nothing here yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              A typical flow: capture a bug report or requirement as a <strong>doc</strong>,
              work through it with an agent, then turn the outcome into a <strong>plan</strong>.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild size="sm">
              <Link href="/docs/new"><Plus className="h-4 w-4" />New doc</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/prompts/new"><Plus className="h-4 w-4" />New prompt</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/skills/new"><Plus className="h-4 w-4" />New skill</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/plans/new"><Plus className="h-4 w-4" />New plan</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
