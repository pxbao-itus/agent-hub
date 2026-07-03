import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { projects, projectMembers } from "@/server/db/schema";
import { eq, and, or, desc } from "drizzle-orm";
import { getAccessibleGroups } from "@/server/auth/access";
import { attachProjectCounts, attachProjectManageFlags } from "@/server/lib/project-access";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { FolderKanban, FileText, Users } from "lucide-react";

export const metadata: Metadata = { title: "Projects" };

type ProjectCardData = {
  id: string;
  name: string;
  description: string | null;
  ownerGroupType: "org" | "department" | "team";
  ownerGroupId: string;
  artifactCount: number;
  memberCount: number;
};

function ProjectCard({ project, spacePath }: { project: ProjectCardData; spacePath: string }) {
  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="h-full cursor-pointer transition-all hover:bg-muted/50 hover:shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <CardTitle className="text-sm leading-snug truncate">{project.name}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {project.description && (
            <p className="line-clamp-2 text-xs text-muted-foreground">{project.description}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{project.artifactCount}</span>
            <span className="flex items-center gap-1"><Users className="h-3 w-3" />{project.memberCount}</span>
            {spacePath && <Badge variant="outline" className="text-[10px]">{spacePath}</Badge>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function ProjectsPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";
  const identity = { userId, systemRole: isSuperAdmin ? ("superadmin" as const) : ("user" as const) };

  type ProjectListRow = typeof projects.$inferSelect & {
    artifactCount: number;
    memberCount: number;
    canManage: boolean;
  };
  let allRows: ProjectListRow[] = [];
  if (isSuperAdmin) {
    const rows = await db.query.projects.findMany({ orderBy: desc(projects.updatedAt) });
    allRows = await attachProjectManageFlags(await attachProjectCounts(rows, db), identity, db);
  } else {
    const groups = await getAccessibleGroups(userId, db);
    if (groups.length) {
      const where = or(
        ...groups.map((g) => and(eq(projects.ownerGroupType, g.groupType), eq(projects.ownerGroupId, g.groupId))),
      );
      const rows = await db.query.projects.findMany({ where, orderBy: desc(projects.updatedAt) });
      allRows = await attachProjectManageFlags(await attachProjectCounts(rows, db), identity, db);
    }
  }

  const mineRows = await db
    .select({ project: projects })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(eq(projectMembers.userId, userId))
    .orderBy(desc(projects.updatedAt));
  const mineIds = new Set(mineRows.map((r) => r.project.id));
  const mine = allRows.filter((p) => mineIds.has(p.id));
  const others = allRows.filter((p) => !mineIds.has(p.id));

  const ownerPaths = await resolveOwnerSlugPaths(
    allRows.map((p) => ({ ownerType: p.ownerGroupType, ownerId: p.ownerGroupId })),
    db,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Projects"
        description="Group docs and plans that belong together, with a shared member list."
        actions={
          <Button asChild>
            <Link href="/projects/new">New project</Link>
          </Button>
        }
      />

      {allRows.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          variant="empty"
          message="No projects yet."
          description="Create a project to group related docs and plans."
          action={
            <Button asChild variant="outline">
              <Link href="/projects/new">Create your first project</Link>
            </Button>
          }
        />
      ) : (
        <>
          {mine.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                My projects
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mine.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    spacePath={ownerPaths.get(`${p.ownerGroupType}:${p.ownerGroupId}`) ?? ""}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {mine.length > 0 ? "All projects" : "Projects"}
            </h2>
            {others.length === 0 && mine.length > 0 ? (
              <p className="text-sm text-muted-foreground">No other projects visible to you.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {others.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    spacePath={ownerPaths.get(`${p.ownerGroupType}:${p.ownerGroupId}`) ?? ""}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
