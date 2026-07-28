import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactVersions, artifactTasks, artifactLinks, projects, projectArtifacts } from "@/server/db/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { canAccessArtifact, canMutatePrompt, canShareArtifact } from "@/server/auth/access";
import { canViewProject, attachProjectManageFlags } from "@/server/lib/project-access";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";
import { getVersionAuthorName } from "@/server/lib/version-author";
import { slugify } from "@/lib/slug";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BodyViewer } from "@/components/ui/body-viewer";
import { McpUsage } from "@/components/ui/mcp-usage";
import { ArtifactMetadataFacts } from "@/components/ui/artifact-metadata-facts";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { DetailPageLayout, DetailMetadataSection } from "@/components/ui/detail-page-layout";
import { DuplicateArtifactButton } from "@/components/ui/duplicate-artifact-button";
import { ExportArtifactButton } from "@/components/ui/export-artifact-button";
import { FavoriteButton } from "@/components/ui/favorite-button";
import { isFavorited } from "@/server/lib/favorites";
import { DeletePlanButton } from "../_components/delete-plan-button";
import { PlanTaskList } from "./_components/plan-task-list";
import { ShareDialog } from "../../_components/share-dialog";
import { PlanLinkedDocs } from "./_components/plan-linked-docs";
import { ArtifactProjectsSection } from "../../_components/artifact-projects-section";
import { AssignmentPanel } from "../../_components/assignment-panel";
import { AssignmentHistory } from "../../_components/assignment-history";
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
  const favorited = await isFavorited(userId, id, db);

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

  // Projects this plan belongs to, filtered to what the caller can see (D-016 cone).
  const projectRows = await db
    .select({ project: projects })
    .from(projectArtifacts)
    .innerJoin(projects, eq(projectArtifacts.projectId, projects.id))
    .where(eq(projectArtifacts.artifactId, id));
  const viewableProjects = [];
  for (const { project } of projectRows) {
    const ok = await canViewProject(identity, project, db);
    if (ok) viewableProjects.push(project);
  }
  const planProjects = await attachProjectManageFlags(viewableProjects, identity, db);

  return (
    <DetailPageLayout
      breadcrumb={<Breadcrumb items={[{ label: "Plans", href: "/plans" }, { label: plan.title }]} />}
      metadataLabel={`Metadata for ${plan.title}`}
      metadata={
        <>
          <DetailMetadataSection title="Details">
            <ArtifactMetadataFacts
              visibility={plan.visibility}
              tags={plan.tags}
              updatedAt={plan.updatedAt}
              authorName={authorName}
              versionNo={currentVersion?.versionNo}
              fetchCount={plan.fetchCount}
              lastFetchedAt={plan.lastFetchedAt}
            />
          </DetailMetadataSection>
          <DetailMetadataSection title="MCP">
            <McpUsage kind="plan" fullSlug={fullSlug} variant="compact" />
          </DetailMetadataSection>
          <DetailMetadataSection title="Linked docs" count={linkedDocs.length}>
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
              compact
            />
          </DetailMetadataSection>
          <DetailMetadataSection title="Projects" count={planProjects.length}>
            <ArtifactProjectsSection
              artifactId={id}
              initialProjects={planProjects.map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description,
                canManage: p.canManage,
              }))}
            />
          </DetailMetadataSection>
          <DetailMetadataSection title="Assignment">
            <AssignmentPanel artifactId={id} canEdit={canEdit} />
          </DetailMetadataSection>
          <DetailMetadataSection title="Assignment history">
            <AssignmentHistory artifactId={id} />
          </DetailMetadataSection>
          {plan.versions.length > 0 && (
            <DetailMetadataSection title="Version history" count={plan.versions.length}>
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
            </DetailMetadataSection>
          )}
        </>
      }
    >
      <div className="space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-2xl font-bold">{plan.title}</h1>
              <Badge variant="secondary">plan</Badge>
            </div>
            {plan.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
            <FavoriteButton artifactId={id} initialFavorited={favorited} />
            <DuplicateArtifactButton artifactId={id} kind="plan" />
            <ExportArtifactButton artifactId={id} title={plan.title} />
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

        {total > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Progress</span>
              <span className="text-muted-foreground">{done}/{total} done{pct !== null ? ` (${pct}%)` : ""}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct ?? 0}%` }} />
            </div>
          </section>
        )}

        {currentVersion && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Overview</h2>
              <span className="text-xs text-muted-foreground">v{currentVersion.versionNo}</span>
            </div>
            <BodyViewer body={currentVersion.body} defaultMode="rendered" />
          </section>
        )}

        {total > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Tasks ({done}/{total})
            </h2>
            <PlanTaskList
              planId={id}
              tasks={tasks.map((t) => ({ id: t.id, content: t.content, status: t.status }))}
              canEdit={canEdit}
            />
          </section>
        )}
      </div>
    </DetailPageLayout>
  );
}
