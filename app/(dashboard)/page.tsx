import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, orgs, mcpTokens, memberships, artifactFavorites } from "@/server/db/schema";
import { eq, and, desc, count, isNull, gt, or } from "drizzle-orm";
import { artifactAccessCondition } from "@/server/auth/access";
import { listMyWork } from "@/server/services/my-work";
import { getDashboardCardLayout } from "@/server/services/dashboard-preferences";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DashboardCardGrid } from "./_components/dashboard-card-grid";
import type { DashboardCardId } from "@/lib/dashboard-cards";
import { BookText, Wrench, ClipboardList, FileText, Plus, Sparkles, Flame, Star, ListChecks } from "lucide-react";

export const metadata = { title: "Dashboard" };

const KIND_ICON: Record<string, React.ElementType> = {
  prompt: BookText,
  skill: Wrench,
  plan: ClipboardList,
  doc: FileText,
};
const KIND_HREF: Record<string, string> = {
  prompt: "/prompts",
  skill: "/skills",
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
  const [[{ promptCount }], [{ skillCount }], [{ planCount }], [{ docCount }], [{ orgCount }], [{ tokenCount }], recentActivity, mostUsed, favorites, dashboardLayout] = await Promise.all([
    db.select({ promptCount: count() }).from(artifacts).where(and(eq(artifacts.kind, "prompt"), accessWhere)),
    db.select({ skillCount: count() }).from(artifacts).where(and(eq(artifacts.kind, "skill"), accessWhere)),
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
    getDashboardCardLayout(userId, db),
  ]);

  const totalArtifacts = promptCount + skillCount + planCount + docCount;
  const displayName = session!.user?.name ?? session!.user?.email ?? "there";
  const myWork = await listMyWork(
    { userId, systemRole: isSuperAdmin ? "superadmin" : "user" },
    { view: "assigned_to_me", sort: "due_date", limit: 5 },
    db,
  );
  const dashboardValues: Record<DashboardCardId, number> = {
    prompts: promptCount,
    skills: skillCount,
    plans: planCount,
    docs: docCount,
    organizations: orgCount,
    mcp_tokens: tokenCount,
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Welcome back, {displayName.split(" ")[0]}!</h1>
        <p className="text-sm text-muted-foreground mt-1">Here&apos;s what&apos;s happening in your workspace.</p>
      </div>

      <DashboardCardGrid initialLayout={dashboardLayout} values={dashboardValues} />

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href="/prompts/new"><Plus className="h-4 w-4" />New prompt</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/skills/new"><Plus className="h-4 w-4" />New skill</Link>
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

      {/* My Work — bounded preview of assigned Docs and Plans */}
      {myWork.items.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="flex items-center gap-1.5 text-lg font-semibold">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              My Work
            </h2>
            <Button asChild variant="ghost" size="sm"><Link href="/my-work">View all</Link></Button>
          </div>
          <div className="divide-y rounded-md border">
            {myWork.items.map((item) => (
              <Link
                key={item.artifact.id}
                href={`/${item.artifact.kind}s/${item.artifact.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                {item.artifact.kind === "plan"
                  ? <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" />
                  : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.artifact.title}</p>
                <Badge variant={item.status === "blocked" ? "warning" : "outline"} className="shrink-0 text-[10px]">
                  {item.status.replace("_", " ")}
                </Badge>
                <span className="hidden text-xs text-muted-foreground sm:inline">{item.dueDate ?? "No due date"}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

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
