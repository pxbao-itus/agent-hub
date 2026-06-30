import { notFound } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactVersions, artifactTasks } from "@/server/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { canMutatePrompt } from "@/server/auth/access";
import { PlanForm } from "../../_components/plan-form";

const getPlan = cache(async (id: string) =>
  db.query.artifacts.findFirst({
    where: and(eq(artifacts.id, id), eq(artifacts.kind, "plan")),
    with: {
      versions: { orderBy: desc(artifactVersions.versionNo), limit: 1 },
      tasks: { orderBy: artifactTasks.position },
    },
  }),
);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const plan = await getPlan(id);
  return { title: plan ? `Edit: ${plan.title}` : "Edit plan" };
}

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const plan = await getPlan(id);
  if (!plan) notFound();

  const canEdit = await canMutatePrompt(
    { userId, systemRole: isSuperAdmin ? "superadmin" : "user" },
    plan,
    db,
  );
  if (!canEdit) notFound();

  const currentVersion = plan.versions[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Edit plan</h1>
        <p className="text-sm text-muted-foreground">{plan.title}</p>
      </div>
      <PlanForm
        mode="edit"
        planId={id}
        initial={{
          title: plan.title,
          slug: plan.slug,
          description: plan.description,
          body: currentVersion?.body ?? "",
          tasks: (plan.tasks ?? []).map((t) => ({
            id: t.id,
            content: t.content,
            status: t.status,
          })),
          tags: plan.tags,
          visibility: plan.visibility,
          ownerType: plan.ownerType,
          ownerId: plan.ownerId,
        }}
      />
    </div>
  );
}
