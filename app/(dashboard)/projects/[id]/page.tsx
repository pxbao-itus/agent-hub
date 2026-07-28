import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { projects, projectArtifacts, projectMembers, artifacts, users, workflows } from "@/server/db/schema";
import { eq, desc } from "drizzle-orm";
import { canAccessArtifact } from "@/server/auth/access";
import { canViewProject, canManageProject } from "@/server/lib/project-access";
import { canViewWorkflow, attachWorkflowProgress } from "@/server/lib/workflow-access";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { DetailPageLayout, DetailMetadataSection } from "@/components/ui/detail-page-layout";
import { DeleteProjectButton } from "../_components/delete-project-button";
import { ProjectArtifactsPanel, ProjectMembersPanel } from "../_components/project-detail-panels";
import { FolderKanban, GitBranch } from "lucide-react";
import { formatRelativeTime } from "@/lib/relative-time";

async function getProject(id: string) {
  return db.query.projects.findFirst({ where: eq(projects.id, id) });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const project = await getProject(id);
  return { title: project?.name ?? "Project" };
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";
  const identity = { userId, systemRole: isSuperAdmin ? ("superadmin" as const) : ("user" as const) };

  const project = await getProject(id);
  if (!project) notFound();

  const viewable = await canViewProject(identity, project, db);
  if (!viewable) notFound();

  const canManage = await canManageProject(identity, project.ownerGroupType, project.ownerGroupId, db);

  const [assigned, memberRows, ownerPaths] = await Promise.all([
    db
      .select({ artifact: artifacts })
      .from(projectArtifacts)
      .innerJoin(artifacts, eq(projectArtifacts.artifactId, artifacts.id))
      .where(eq(projectArtifacts.projectId, project.id)),
    db
      .select({ id: users.id, name: users.name, email: users.email, image: users.image })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(eq(projectMembers.projectId, project.id)),
    resolveOwnerSlugPaths([{ ownerType: project.ownerGroupType, ownerId: project.ownerGroupId }], db),
  ]);

  const readableArtifacts = [];
  for (const { artifact } of assigned) {
    const ok = await canAccessArtifact(identity, artifact, db);
    if (ok) readableArtifacts.push(artifact);
  }

  const spacePath = ownerPaths.get(`${project.ownerGroupType}:${project.ownerGroupId}`) ?? "";

  const linkedWorkflowRows = await db.query.workflows.findMany({
    where: eq(workflows.projectId, project.id),
    orderBy: desc(workflows.updatedAt),
  });
  const viewableWorkflows = [];
  for (const w of linkedWorkflowRows) {
    const ok = await canViewWorkflow(identity, w, db);
    if (ok) viewableWorkflows.push(w);
  }
  const workflowsWithProgress = await attachWorkflowProgress(viewableWorkflows, db);

  const panelProps = {
    projectId: id,
    canManage,
    initialArtifacts: readableArtifacts.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      description: a.description,
    })),
    initialMembers: memberRows,
  };

  return (
    <DetailPageLayout
      breadcrumb={<Breadcrumb items={[{ label: "Projects", href: "/projects" }, { label: project.name }]} />}
      metadataLabel={`Metadata for ${project.name}`}
      metadata={
        <>
          <DetailMetadataSection title="Details">
            <dl className="space-y-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">Space</dt>
                <dd className="min-w-0 truncate text-right" title={spacePath || project.ownerGroupType}>
                  {spacePath || project.ownerGroupType}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">Updated</dt>
                <dd className="text-right">{formatRelativeTime(project.updatedAt)}</dd>
              </div>
            </dl>
          </DetailMetadataSection>
          <DetailMetadataSection title="Members" count={memberRows.length}>
            <ProjectMembersPanel {...panelProps} />
          </DetailMetadataSection>
          <DetailMetadataSection title="Workflows" count={workflowsWithProgress.length}>
            {workflowsWithProgress.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workflows linked yet.</p>
            ) : (
              <div className="divide-y rounded-md border">
                {workflowsWithProgress.map((w) => (
                  <Link
                    key={w.id}
                    href={`/workflows/${w.id}`}
                    className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-muted/30"
                  >
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{w.name}</span>
                    {w.stageCount > 0 && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {w.doneCount}/{w.stageCount} done
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </DetailMetadataSection>
        </>
      }
    >
      <div className="space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <FolderKanban className="h-5 w-5 text-muted-foreground" />
              <h1 className="break-words text-2xl font-bold">{project.name}</h1>
              {spacePath && <Badge variant="outline">{spacePath}</Badge>}
            </div>
            {project.description && <p className="text-sm text-muted-foreground">{project.description}</p>}
          </div>
          {canManage && (
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/projects/${id}/edit`}>Edit</Link>
              </Button>
              <DeleteProjectButton projectId={id} />
            </div>
          )}
        </div>

        <ProjectArtifactsPanel {...panelProps} />
      </div>
    </DetailPageLayout>
  );
}
