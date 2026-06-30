import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactVersions, artifactTasks } from "@/server/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getAccessibleGroups, canMutatePrompt } from "@/server/auth/access";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/code-block";
import { DeletePlanButton } from "../_components/delete-plan-button";
import { PlanTaskList } from "./_components/plan-task-list";

const getPlan = cache(async (id: string) =>
  db.query.artifacts.findFirst({
    where: and(eq(artifacts.id, id), eq(artifacts.kind, "plan")),
    with: {
      versions: { orderBy: desc(artifactVersions.versionNo) },
      tasks: { orderBy: artifactTasks.position },
    },
  }),
);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const plan = await getPlan(id);
  return { title: plan?.title ?? "Plan" };
}

export default async function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const plan = await getPlan(id);
  if (!plan) notFound();

  if (!isSuperAdmin && plan.visibility !== "public") {
    const isOwner = plan.ownerType === "user" && plan.ownerId === userId;
    if (!isOwner) {
      if (plan.visibility === "group") {
        const groups = await getAccessibleGroups(userId, db);
        const allowed = groups.some(
          (g) => g.groupType === plan.ownerType && g.groupId === plan.ownerId,
        );
        if (!allowed) notFound();
      } else {
        notFound();
      }
    }
  }

  const canEdit = await canMutatePrompt(
    { userId, systemRole: isSuperAdmin ? "superadmin" : "user" },
    plan,
    db,
  );

  const currentVersion = plan.versions[0];
  const tasks = plan.tasks ?? [];
  const done = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">{plan.title}</h1>
            <Badge variant="secondary">plan</Badge>
            <Badge variant="outline">{plan.visibility}</Badge>
          </div>
          {plan.description && (
            <p className="text-sm text-muted-foreground">{plan.description}</p>
          )}
          {plan.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {plan.tags.map((tag) => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
            </div>
          )}
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/plans/${id}/edit`}>Edit</Link>
            </Button>
            <DeletePlanButton planId={id} />
          </div>
        )}
      </div>

      {/* Progress */}
      {total > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Progress</span>
            <span className="text-muted-foreground">{done}/{total} done{pct !== null ? ` (${pct}%)` : ""}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
        </section>
      )}

      {/* Overview */}
      {currentVersion && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Overview
            </h2>
            <span className="text-xs text-muted-foreground">v{currentVersion.versionNo}</span>
          </div>
          <CodeBlock>{currentVersion.body}</CodeBlock>
        </section>
      )}

      {/* Tasks */}
      {total > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Tasks ({done}/{total})
          </h2>
          <PlanTaskList
            tasks={tasks.map((t) => ({
              id: t.id,
              content: t.content,
              status: t.status,
            }))}
            canEdit={canEdit}
          />
        </section>
      )}

      {/* Version history (overview only) */}
      {plan.versions.length > 1 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Version history
          </h2>
          <div className="divide-y rounded-md border text-sm">
            {plan.versions.map((v) => (
              <div key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="font-mono text-xs text-muted-foreground w-8">v{v.versionNo}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(v.createdAt).toLocaleDateString()}
                </span>
                {v.changelog && (
                  <span className="text-xs text-foreground truncate">{v.changelog}</span>
                )}
                {v.id === plan.currentVersionId && (
                  <Badge variant="outline" className="ml-auto text-[10px]">current</Badge>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
