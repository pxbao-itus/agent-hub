import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { projects } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { canManageProject } from "@/server/lib/project-access";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { ProjectForm } from "../../_components/project-form";

async function getProject(id: string) {
  return db.query.projects.findFirst({ where: eq(projects.id, id) });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const project = await getProject(id);
  return { title: project ? `Edit: ${project.name}` : "Edit project" };
}

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";
  const identity = { userId, systemRole: isSuperAdmin ? ("superadmin" as const) : ("user" as const) };

  const project = await getProject(id);
  if (!project) notFound();

  const allowed = await canManageProject(identity, project.ownerGroupType, project.ownerGroupId, db);
  if (!allowed) redirect(`/projects/${id}`);

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${id}` },
          { label: "Edit" },
        ]}
      />
      <div>
        <h1 className="text-2xl font-bold">Edit project</h1>
        <p className="text-sm text-muted-foreground">{project.name}</p>
      </div>
      <div className="max-w-2xl">
        <ProjectForm
          mode="edit"
          projectId={id}
          initial={{ name: project.name, description: project.description }}
        />
      </div>
    </div>
  );
}
