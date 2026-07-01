import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactVersions, artifactTasks, artifactLinks } from "@/server/db/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { canAccessArtifact, canMutatePrompt, canShareArtifact } from "@/server/auth/access";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";
import { getVersionAuthorName } from "@/server/lib/version-author";
import { slugify } from "@/lib/slug";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BodyViewer } from "@/components/ui/body-viewer";
import { McpUsage } from "@/components/ui/mcp-usage";
import { ArtifactMeta } from "@/components/ui/artifact-meta";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { DeletePlanButton } from "../_components/delete-plan-button";
import { PlanTaskList } from "./_components/plan-task-list";
import { ShareDialog } from "../../_components/share-dialog";
import { PlanLinkedDocs } from "./_components/plan-linked-docs";
import { PlanVersionHistory } from "./_components/plan-version-history";

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

  const accessible = await canAccessArtifact({ userId, systemRole: isSuperAdmin ? "superadmin" : "user" }, plan, db);
  if (!accessible) notFound();

  const identity = { userId, systemRole: isSuperAdmin ? "superadmin" : "user" } as const;
  const canEdit = await canMutatePrompt(identity, plan, db);
  const canShare = await canShareArtifact(identity, plan, db);

  const currentVersion = plan.versions[0];
  const tasks = plan.tasks ?? [];

  const ownerPaths = await resolveOwnerSlugPaths(
    [{ ownerType: plan.ownerType, ownerId: plan.ownerId }],
    db,
  );
  const spacePath = ownerPaths.get(`${plan.ownerType}:${plan.ownerId}`) ?? "";
  const fullSlug = [spacePath, plan.slug ?? slugify(plan.title)].filter(Boolean).join(".");
  const authorName = await getVersionAuthorName(currentVersion?.createdBy, db);

  // Linked docs — filtered to what this user can access
  const rawLinks = await db.query.artifactLinks.findMany({
    where: and(eq(artifactLinks.sourceArtifactId, id), eq(artifactLinks.relation, "doc")),
    orderBy: asc(artifactLinks.position),
    with: { target: { with: { versions: { limit: 1, orderBy: desc(artifactVersions.versionNo) } } } },
  });
  const linkedDocs = [];
  for (const link of rawLinks) {
    if (!link.target) continue;
    const ok = await canAccessArtifact(identity, link.target, db);
    if (ok) linkedDocs.push(link);
  }
  const done = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : null;

  return (
    <div className="space-y-8">
      <Breadcrumb items={[{ label: "Plans", href: "/plans" }, { label: plan.title }]} />

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
          {currentVersion && (
            <ArtifactMeta updatedAt={plan.updatedAt} authorName={authorName} versionNo={currentVersion.versionNo} />
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {canShare && <ShareDialog artifactId={id} artifactTitle={plan.title} />}
          {canEdit && (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={`/plans/${id}/edit`}>Edit</Link>
              </Button>
              <DeletePlanButton planId={id} />
            </>
          )}
        </div>
      </div>

      <McpUsage kind="plan" fullSlug={fullSlug} />

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
          <BodyViewer body={currentVersion.body} defaultMode="rendered" />
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

      {/* Linked docs */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Linked docs {linkedDocs.length > 0 ? `(${linkedDocs.length})` : ""}
        </h2>
        <PlanLinkedDocs
          sourceId={id}
          initialLinks={linkedDocs.map((l) => ({
            id: l.id,
            position: l.position,
            target: l.target
              ? {
                  id: l.target.id,
                  title: l.target.title,
                  description: l.target.description,
                  slug: l.target.slug,
                  body: l.target.versions[0]?.body ?? null,
                }
              : null,
          }))}
          canEdit={canEdit}
        />
      </section>

      {/* Version history (overview only) */}
      {plan.versions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Version history
          </h2>
          <PlanVersionHistory
            planId={id}
            versions={plan.versions.map((v) => ({
              id: v.id,
              versionNo: v.versionNo,
              body: v.body,
              changelog: v.changelog,
              createdAt: v.createdAt,
            }))}
            currentVersionId={plan.currentVersionId}
            canEdit={canEdit}
          />
        </section>
      )}
    </div>
  );
}
