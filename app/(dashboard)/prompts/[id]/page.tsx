import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactVersions, artifactLinks } from "@/server/db/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { canAccessArtifact, canMutatePrompt, canShareArtifact } from "@/server/auth/access";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";
import { getVersionAuthorName } from "@/server/lib/version-author";
import { slugify } from "@/lib/slug";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DuplicateArtifactButton } from "@/components/ui/duplicate-artifact-button";
import { ExportArtifactButton } from "@/components/ui/export-artifact-button";
import { FavoriteButton } from "@/components/ui/favorite-button";
import { isFavorited } from "@/server/lib/favorites";
import { DeletePromptButton } from "./_components/delete-prompt-button";
import { VersionHistory } from "./_components/version-history";
import { BodyViewer } from "@/components/ui/body-viewer";
import { McpUsage } from "@/components/ui/mcp-usage";
import { ArtifactMetadataFacts } from "@/components/ui/artifact-metadata-facts";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { DetailPageLayout, DetailMetadataSection } from "@/components/ui/detail-page-layout";
import { ShareDialog } from "../../_components/share-dialog";
import { LinkedDocsSection } from "../../_components/linked-docs-section";

const getPrompt = cache(async (id: string) =>
  db.query.artifacts.findFirst({
    where: and(eq(artifacts.id, id), eq(artifacts.kind, "prompt")),
    with: {
      versions: { orderBy: desc(artifactVersions.versionNo) },
      variables: true,
    },
  }),
);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const prompt = await getPrompt(id);
  return { title: prompt?.title ?? "Prompt" };
}

export default async function PromptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const prompt = await getPrompt(id);
  if (!prompt) notFound();

  const accessible = await canAccessArtifact({ userId, systemRole: isSuperAdmin ? "superadmin" : "user" }, prompt, db);
  if (!accessible) notFound();

  const identity = { userId, systemRole: isSuperAdmin ? "superadmin" : "user" } as const;
  const canEdit = await canMutatePrompt(identity, prompt, db);
  const canShare = await canShareArtifact(identity, prompt, db);
  const currentVersion = prompt.versions[0];
  const favorited = await isFavorited(userId, id, db);

  const ownerPaths = await resolveOwnerSlugPaths(
    [{ ownerType: prompt.ownerType, ownerId: prompt.ownerId }],
    db,
  );
  const spacePath = ownerPaths.get(`${prompt.ownerType}:${prompt.ownerId}`) ?? "";
  const fullSlug = [spacePath, prompt.slug ?? slugify(prompt.title)].filter(Boolean).join(".");
  const authorName = await getVersionAuthorName(currentVersion?.createdBy, db);

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

  const linkedDocRows = linkedDocs.map((l) => ({
    id: l.id,
    position: l.position,
    target: l.target ? {
      id: l.target.id,
      title: l.target.title,
      description: l.target.description,
      slug: l.target.slug,
      body: l.target.versions[0]?.body ?? null,
    } : null,
  }));

  return (
    <DetailPageLayout
      breadcrumb={<Breadcrumb items={[{ label: "Prompts", href: "/prompts" }, { label: prompt.title }]} />}
      metadataLabel={`Metadata for ${prompt.title}`}
      metadata={
        <>
          <DetailMetadataSection title="Details">
            <ArtifactMetadataFacts
              visibility={prompt.visibility}
              tags={prompt.tags}
              updatedAt={prompt.updatedAt}
              authorName={authorName}
              versionNo={currentVersion?.versionNo}
              fetchCount={prompt.fetchCount}
              lastFetchedAt={prompt.lastFetchedAt}
            />
          </DetailMetadataSection>
          <DetailMetadataSection title="MCP">
            <McpUsage kind="prompt" fullSlug={fullSlug} variant="compact" />
          </DetailMetadataSection>
          {(canEdit || linkedDocs.length > 0) && (
            <DetailMetadataSection title="Linked docs" count={linkedDocs.length}>
              <LinkedDocsSection sourceId={id} initialLinks={linkedDocRows} canEdit={canEdit} compact />
            </DetailMetadataSection>
          )}
          {prompt.versions.length > 0 && (
            <DetailMetadataSection title="Version history" count={prompt.versions.length}>
              <VersionHistory
                promptId={id}
                versions={prompt.versions}
                currentVersionId={prompt.currentVersionId}
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
              <h1 className="break-words text-2xl font-bold">{prompt.title}</h1>
              <Badge>prompt</Badge>
            </div>
            {prompt.description && <p className="text-sm text-muted-foreground">{prompt.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
            <FavoriteButton artifactId={id} initialFavorited={favorited} />
            <DuplicateArtifactButton artifactId={id} kind="prompt" />
            <ExportArtifactButton artifactId={id} title={prompt.title} />
            {canShare && <ShareDialog artifactId={id} artifactTitle={prompt.title} />}
            {canEdit && (
              <>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/prompts/${id}/edit`}>Edit</Link>
                </Button>
                <DeletePromptButton promptId={id} />
              </>
            )}
          </div>
        </div>

        {currentVersion && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Prompt body</h2>
              <span className="text-xs text-muted-foreground">v{currentVersion.versionNo}</span>
            </div>
            <BodyViewer body={currentVersion.body} defaultMode="raw" />
          </section>
        )}

        {prompt.variables.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Variables</h2>
            <div className="divide-y rounded-md border">
              {prompt.variables.map((v) => (
                <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <code className="font-mono text-sm">{"{{" + v.name + "}}"}</code>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {v.defaultValue && <span>default: {v.defaultValue}</span>}
                    {v.required && <Badge variant="outline">required</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </DetailPageLayout>
  );
}
