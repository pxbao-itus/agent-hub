import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { projects, projectArtifacts, projectMembers, artifacts, users } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { canAccessArtifact } from "@/server/auth/access";
import { canViewProject, canManageProject } from "@/server/lib/project-access";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { DeleteProjectButton } from "../_components/delete-project-button";
import { ProjectDetailPanels } from "../_components/project-detail-panels";
import { FolderKanban } from "lucide-react";

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

  return (
    <div className="space-y-8">
      <Breadcrumb items={[{ label: "Projects", href: "/projects" }, { label: project.name }]} />

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-bold">{project.name}</h1>
            {spacePath && <Badge variant="outline">{spacePath}</Badge>}
          </div>
          {project.description && (
            <p className="text-sm text-muted-foreground">{project.description}</p>
          )}
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${id}/edit`}>Edit</Link>
            </Button>
            <DeleteProjectButton projectId={id} />
          </div>
        )}
      </div>

      <ProjectDetailPanels
        projectId={id}
        canManage={canManage}
        initialArtifacts={readableArtifacts.map((a) => ({
          id: a.id,
          kind: a.kind,
          title: a.title,
          description: a.description,
        }))}
        initialMembers={memberRows}
      />
    </div>
  );
}
