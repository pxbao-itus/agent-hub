import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { workflows } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { canManageWorkflow } from "@/server/lib/workflow-access";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { WorkflowForm } from "../../_components/workflow-form";

async function getWorkflow(id: string) {
  return db.query.workflows.findFirst({ where: eq(workflows.id, id) });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const workflow = await getWorkflow(id);
  return { title: workflow ? `Edit: ${workflow.name}` : "Edit workflow" };
}

export default async function EditWorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";
  const identity = { userId, systemRole: isSuperAdmin ? ("superadmin" as const) : ("user" as const) };

  const workflow = await getWorkflow(id);
  if (!workflow) notFound();

  const allowed = await canManageWorkflow(identity, workflow.ownerGroupType, workflow.ownerGroupId, db);
  if (!allowed) redirect(`/workflows/${id}`);

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Workflows", href: "/workflows" },
          { label: workflow.name, href: `/workflows/${id}` },
          { label: "Edit" },
        ]}
      />
      <div>
        <h1 className="text-2xl font-bold">Edit workflow</h1>
        <p className="text-sm text-muted-foreground">{workflow.name}</p>
      </div>
      <div className="max-w-2xl">
        <WorkflowForm
          mode="edit"
          workflowId={id}
          initial={{ name: workflow.name, description: workflow.description, projectId: workflow.projectId }}
        />
      </div>
    </div>
  );
}
