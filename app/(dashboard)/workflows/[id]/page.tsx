import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { workflows, workflowStages, workflowStageArtifacts, artifacts, projects } from "@/server/db/schema";
import { eq, asc } from "drizzle-orm";
import { canAccessArtifact } from "@/server/auth/access";
import { canViewWorkflow, canManageWorkflow } from "@/server/lib/workflow-access";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { DeleteWorkflowButton } from "../_components/delete-workflow-button";
import { WorkflowPipeline } from "../_components/workflow-pipeline";
import { GitBranch, FolderKanban } from "lucide-react";

async function getWorkflow(id: string) {
  return db.query.workflows.findFirst({ where: eq(workflows.id, id) });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const workflow = await getWorkflow(id);
  return { title: workflow?.name ?? "Workflow" };
}

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";
  const identity = { userId, systemRole: isSuperAdmin ? ("superadmin" as const) : ("user" as const) };

  const workflow = await getWorkflow(id);
  if (!workflow) notFound();

  const viewable = await canViewWorkflow(identity, workflow, db);
  if (!viewable) notFound();

  const canManage = await canManageWorkflow(identity, workflow.ownerGroupType, workflow.ownerGroupId, db);

  const [stageRows, stageArtifactRows, ownerPaths, linkedProject] = await Promise.all([
    db.query.workflowStages.findMany({ where: eq(workflowStages.workflowId, workflow.id), orderBy: asc(workflowStages.position) }),
    db
      .select({ stageId: workflowStageArtifacts.stageId, artifact: artifacts })
      .from(workflowStageArtifacts)
      .innerJoin(workflowStages, eq(workflowStageArtifacts.stageId, workflowStages.id))
      .innerJoin(artifacts, eq(workflowStageArtifacts.artifactId, artifacts.id))
      .where(eq(workflowStages.workflowId, workflow.id))
      .orderBy(asc(workflowStageArtifacts.position)),
    resolveOwnerSlugPaths([{ ownerType: workflow.ownerGroupType, ownerId: workflow.ownerGroupId }], db),
    workflow.projectId ? db.query.projects.findFirst({ where: eq(projects.id, workflow.projectId), columns: { id: true, name: true } }) : null,
  ]);

  const byStage = new Map<string, typeof artifacts.$inferSelect[]>();
  for (const row of stageArtifactRows) {
    const ok = await canAccessArtifact(identity, row.artifact, db);
    if (!ok) continue;
    if (!byStage.has(row.stageId)) byStage.set(row.stageId, []);
    byStage.get(row.stageId)!.push(row.artifact);
  }

  const initialStages = stageRows.map((stage) => ({
    id: stage.id,
    name: stage.name,
    position: stage.position,
    status: stage.status,
    artifacts: (byStage.get(stage.id) ?? []).map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      description: a.description,
    })),
  }));

  const spacePath = ownerPaths.get(`${workflow.ownerGroupType}:${workflow.ownerGroupId}`) ?? "";

  return (
    <div className="space-y-8">
      <Breadcrumb items={[{ label: "Workflows", href: "/workflows" }, { label: workflow.name }]} />

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-bold">{workflow.name}</h1>
            {spacePath && <Badge variant="outline">{spacePath}</Badge>}
            {linkedProject && (
              <Link href={`/projects/${linkedProject.id}`}>
                <Badge variant="secondary" className="gap-1">
                  <FolderKanban className="h-3 w-3" />
                  {linkedProject.name}
                </Badge>
              </Link>
            )}
          </div>
          {workflow.description && (
            <p className="text-sm text-muted-foreground">{workflow.description}</p>
          )}
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/workflows/${id}/edit`}>Edit</Link>
            </Button>
            <DeleteWorkflowButton workflowId={id} />
          </div>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Stages</h2>
        <WorkflowPipeline workflowId={id} canManage={canManage} initialStages={initialStages} />
      </section>
    </div>
  );
}
