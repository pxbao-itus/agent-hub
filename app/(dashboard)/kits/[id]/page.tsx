import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactVersions, artifactMembers, artifactLinks } from "@/server/db/schema";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { canAccessArtifact, canMutatePrompt, canShareArtifact } from "@/server/auth/access";
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
import { DeleteKitButton } from "../_components/delete-kit-button";
import { KitVersionHistory } from "./_components/kit-version-history";
import { ShareDialog } from "../../_components/share-dialog";
import { LinkedDocsSection } from "../../_components/linked-docs-section";
import { Package, BookText, Wrench } from "lucide-react";

const getKit = cache(async (id: string) =>
  db.query.artifacts.findFirst({
    where: and(eq(artifacts.id, id), eq(artifacts.kind, "kit")),
    with: {
      versions: { orderBy: desc(artifactVersions.versionNo) },
      members: { orderBy: asc(artifactMembers.position) },
    },
  }),
);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const kit = await getKit(id);
  return { title: kit?.title ?? "Kit" };
}

const KIND_ICON: Record<string, React.ElementType> = {
  prompt: BookText,
  skill: Wrench,
  kit: Package,
};

const KIND_HREF: Record<string, string> = {
  prompt: "/prompts",
  skill: "/skills",
  kit: "/kits",
};

export default async function KitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const kit = await getKit(id);
  if (!kit) notFound();

  const accessible = await canAccessArtifact({ userId, systemRole: isSuperAdmin ? "superadmin" : "user" }, kit, db);
  if (!accessible) notFound();

  const identity = { userId, systemRole: isSuperAdmin ? "superadmin" : "user" } as const;
  const canEdit = await canMutatePrompt(identity, kit, db);
  const canShare = await canShareArtifact(identity, kit, db);
  const currentVersion = kit.versions[0];
  const favorited = await isFavorited(userId, id, db);

  const ownerPaths = await resolveOwnerSlugPaths(
    [{ ownerType: kit.ownerType, ownerId: kit.ownerId }],
    db,
  );
  const spacePath = ownerPaths.get(`${kit.ownerType}:${kit.ownerId}`) ?? "";
  const fullSlug = [spacePath, kit.slug ?? slugify(kit.title)].filter(Boolean).join(".");
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

  // Resolve member artifact details
  const memberIds = kit.members.map((m) => m.memberArtifactId);
  const memberArtifacts =
    memberIds.length > 0
      ? await db.query.artifacts.findMany({
          where: inArray(artifacts.id, memberIds),
          columns: { id: true, kind: true, title: true, slug: true, description: true },
        })
      : [];
  const memberById = new Map(memberArtifacts.map((a) => [a.id, a]));

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
      breadcrumb={<Breadcrumb items={[{ label: "Kits", href: "/kits" }, { label: kit.title }]} />}
      metadataLabel={`Metadata for ${kit.title}`}
      metadata={
        <>
          <DetailMetadataSection title="Details">
            <ArtifactMetadataFacts
              visibility={kit.visibility}
              tags={kit.tags}
              updatedAt={kit.updatedAt}
              authorName={authorName}
              versionNo={currentVersion?.versionNo}
              fetchCount={kit.fetchCount}
              lastFetchedAt={kit.lastFetchedAt}
            />
          </DetailMetadataSection>
          <DetailMetadataSection title="MCP">
            <McpUsage kind="kit" fullSlug={fullSlug} variant="compact" />
          </DetailMetadataSection>
          {(canEdit || linkedDocs.length > 0) && (
            <DetailMetadataSection title="Linked docs" count={linkedDocs.length}>
              <LinkedDocsSection sourceId={id} initialLinks={linkedDocRows} canEdit={canEdit} compact />
            </DetailMetadataSection>
          )}
          {kit.versions.length > 0 && (
            <DetailMetadataSection title="Version history" count={kit.versions.length}>
              <KitVersionHistory
                kitId={id}
                versions={kit.versions.map((v) => ({
                  id: v.id,
                  versionNo: v.versionNo,
                  body: v.body,
                  changelog: v.changelog,
                  createdAt: v.createdAt,
                }))}
                currentVersionId={kit.currentVersionId}
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
              <h1 className="break-words text-2xl font-bold">{kit.title}</h1>
              <Badge variant="outline">kit</Badge>
            </div>
            {kit.description && <p className="text-sm text-muted-foreground">{kit.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
            <FavoriteButton artifactId={id} initialFavorited={favorited} />
            <DuplicateArtifactButton artifactId={id} kind="kit" />
            <ExportArtifactButton artifactId={id} title={kit.title} />
            {canShare && <ShareDialog artifactId={id} artifactTitle={kit.title} />}
            {canEdit && (
              <>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/kits/${id}/edit`}>Edit</Link>
                </Button>
                <DeleteKitButton kitId={id} />
              </>
            )}
          </div>
        </div>

        {currentVersion && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Overview</h2>
              <span className="text-xs text-muted-foreground">v{currentVersion.versionNo}</span>
            </div>
            <BodyViewer body={currentVersion.body} defaultMode="rendered" />
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Members ({kit.members.length})
          </h2>
          {kit.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members yet.</p>
          ) : (
            <div className="divide-y rounded-md border">
              {kit.members.map((m) => {
                const artifact = memberById.get(m.memberArtifactId);
                if (!artifact) return null;
                const Icon = KIND_ICON[artifact.kind] ?? Package;
                const href = `${KIND_HREF[artifact.kind] ?? "/"}/${m.memberArtifactId}`;
                return (
                  <Link
                    key={m.id}
                    href={href}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{artifact.title}</p>
                      {artifact.description && <p className="truncate text-xs text-muted-foreground">{artifact.description}</p>}
                    </div>
                    <Badge
                      variant={artifact.kind === "prompt" ? "default" : artifact.kind === "skill" ? "secondary" : "outline"}
                      className="shrink-0 text-[10px]"
                    >
                      {artifact.kind}
                    </Badge>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </DetailPageLayout>
  );
}
