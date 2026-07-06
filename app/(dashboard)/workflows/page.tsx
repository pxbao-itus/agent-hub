import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { workflows, projects } from "@/server/db/schema";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import { getAccessibleGroups } from "@/server/auth/access";
import { attachWorkflowProgress, attachWorkflowManageFlags } from "@/server/lib/workflow-access";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { GitBranch, FolderKanban } from "lucide-react";

export const metadata: Metadata = { title: "Workflows" };

type WorkflowCardData = {
  id: string;
  name: string;
  description: string | null;
  ownerGroupType: "org" | "department" | "team";
  ownerGroupId: string;
  projectId: string | null;
  stageCount: number;
  doneCount: number;
};

function WorkflowCard({
  workflow,
  spacePath,
  projectName,
}: {
  workflow: WorkflowCardData;
  spacePath: string;
  projectName?: string;
}) {
  const pct = workflow.stageCount > 0 ? Math.round((workflow.doneCount / workflow.stageCount) * 100) : null;
  return (
    <Link href={`/workflows/${workflow.id}`}>
      <Card className="h-full cursor-pointer transition-all hover:bg-muted/50 hover:shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <CardTitle className="text-sm leading-snug truncate">{workflow.name}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {workflow.description && (
            <p className="line-clamp-2 text-xs text-muted-foreground">{workflow.description}</p>
          )}
          {workflow.stageCount > 0 && (
            <div className="space-y-1">
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[10px] text-muted-foreground">{workflow.doneCount}/{workflow.stageCount} stages done</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {spacePath && <Badge variant="outline" className="text-[10px]">{spacePath}</Badge>}
            {projectName && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <FolderKanban className="h-2.5 w-2.5" />
                {projectName}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function WorkflowsPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";
  const identity = { userId, systemRole: isSuperAdmin ? ("superadmin" as const) : ("user" as const) };

  type WorkflowListRow = typeof workflows.$inferSelect & {
    stageCount: number;
    doneCount: number;
    canManage: boolean;
  };
  let rows: WorkflowListRow[] = [];
  if (isSuperAdmin) {
    const found = await db.query.workflows.findMany({ orderBy: desc(workflows.updatedAt) });
    rows = await attachWorkflowManageFlags(await attachWorkflowProgress(found, db), identity, db);
  } else {
    const groups = await getAccessibleGroups(userId, db);
    if (groups.length) {
      const where = or(
        ...groups.map((g) => and(eq(workflows.ownerGroupType, g.groupType), eq(workflows.ownerGroupId, g.groupId))),
      );
      const found = await db.query.workflows.findMany({ where, orderBy: desc(workflows.updatedAt) });
      rows = await attachWorkflowManageFlags(await attachWorkflowProgress(found, db), identity, db);
    }
  }

  const ownerPaths = await resolveOwnerSlugPaths(
    rows.map((w) => ({ ownerType: w.ownerGroupType, ownerId: w.ownerGroupId })),
    db,
  );

  const projectIds = [...new Set(rows.map((w) => w.projectId).filter((id): id is string => !!id))];
  const projectRows = projectIds.length
    ? await db.query.projects.findMany({ where: inArray(projects.id, projectIds), columns: { id: true, name: true } })
    : [];
  const projectNameById = new Map(projectRows.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflows"
        description="Processes made of ordered stages — the thread that ties docs, plans, and toolkits together across a lifecycle."
        actions={
          <Button asChild>
            <Link href="/workflows/new">New workflow</Link>
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          variant="empty"
          message="No workflows yet."
          description="Create a workflow to define the stages a process moves through."
          action={
            <Button asChild variant="outline">
              <Link href="/workflows/new">Create your first workflow</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((w) => (
            <WorkflowCard
              key={w.id}
              workflow={w}
              spacePath={ownerPaths.get(`${w.ownerGroupType}:${w.ownerGroupId}`) ?? ""}
              projectName={w.projectId ? projectNameById.get(w.projectId) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
