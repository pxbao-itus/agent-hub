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
import { CodeBlock } from "@/components/ui/code-block";
import { BodyViewer } from "@/components/ui/body-viewer";
import { McpUsage } from "@/components/ui/mcp-usage";
import { ArtifactMeta } from "@/components/ui/artifact-meta";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { DuplicateArtifactButton } from "@/components/ui/duplicate-artifact-button";
import { ExportArtifactButton } from "@/components/ui/export-artifact-button";
import { FavoriteButton } from "@/components/ui/favorite-button";
import { isFavorited } from "@/server/lib/favorites";
import { DeleteSkillButton } from "../_components/delete-skill-button";
import { SkillVersionHistory } from "./_components/skill-version-history";
import { ShareDialog } from "../../_components/share-dialog";
import { LinkedDocsSection } from "../../_components/linked-docs-section";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";

const getSkill = cache(async (id: string) =>
  db.query.artifacts.findFirst({
    where: and(eq(artifacts.id, id), eq(artifacts.kind, "skill")),
    with: {
      versions: {
        orderBy: desc(artifactVersions.versionNo),
        with: { files: true },
      },
    },
  }),
);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const skill = await getSkill(id);
  return { title: skill?.title ?? "Skill" };
}

export default async function SkillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const skill = await getSkill(id);
  if (!skill) notFound();

  const accessible = await canAccessArtifact({ userId, systemRole: isSuperAdmin ? "superadmin" : "user" }, skill, db);
  if (!accessible) notFound();

  const identity = { userId, systemRole: isSuperAdmin ? "superadmin" : "user" } as const;
  const canEdit = await canMutatePrompt(identity, skill, db);
  const canShare = await canShareArtifact(identity, skill, db);
  const currentVersion = skill.versions[0];
  const currentFiles = currentVersion?.files ?? [];
  const favorited = await isFavorited(userId, id, db);

  const ownerPaths = await resolveOwnerSlugPaths(
    [{ ownerType: skill.ownerType, ownerId: skill.ownerId }],
    db,
  );
  const spacePath = ownerPaths.get(`${skill.ownerType}:${skill.ownerId}`) ?? "";
  const fullSlug = [spacePath, skill.slug ?? slugify(skill.title)].filter(Boolean).join(".");
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

  return (
    <div className="space-y-8">
      <Breadcrumb items={[{ label: "Skills", href: "/skills" }, { label: skill.title }]} />

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{skill.title}</h1>
            <Badge variant="secondary">skill</Badge>
            <Badge variant="outline">{skill.visibility}</Badge>
          </div>
          {skill.description && (
            <p className="text-sm text-muted-foreground">{skill.description}</p>
          )}
          {skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {skill.tags.map((tag) => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
            </div>
          )}
          {currentVersion && (
            <ArtifactMeta
              updatedAt={skill.updatedAt}
              authorName={authorName}
              versionNo={currentVersion.versionNo}
              fetchCount={skill.fetchCount}
              lastFetchedAt={skill.lastFetchedAt}
            />
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <FavoriteButton artifactId={id} initialFavorited={favorited} />
          <DuplicateArtifactButton artifactId={id} kind="skill" />
          <ExportArtifactButton artifactId={id} title={skill.title} />
          {canShare && <ShareDialog artifactId={id} artifactTitle={skill.title} />}
          {canEdit && (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={`/skills/${id}/edit`}>Edit</Link>
              </Button>
              <DeleteSkillButton skillId={id} />
            </>
          )}
        </div>
      </div>

      <McpUsage kind="skill" fullSlug={fullSlug} />

      {/* Instructions */}
      {currentVersion && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Instructions
            </h2>
            <span className="text-xs text-muted-foreground">v{currentVersion.versionNo}</span>
          </div>
          <BodyViewer body={currentVersion.body} defaultMode="rendered" />
        </section>
      )}

      {/* Bundled files */}
      {currentFiles.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Bundled files ({currentFiles.length})
          </h2>
          <div className="divide-y rounded-md border">
            {currentFiles.map((file) => (
              <details key={file.id} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 hover:bg-muted/50 transition-colors">
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-open:hidden" />
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground hidden group-open:block" />
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-mono">{file.path}</span>
                  {file.mimeType && (
                    <span className="ml-auto text-xs text-muted-foreground">{file.mimeType}</span>
                  )}
                </summary>
                <div className="border-t">
                  <CodeBlock>{file.content}</CodeBlock>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Linked docs */}
      {(canEdit || linkedDocs.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Linked docs {linkedDocs.length > 0 ? `(${linkedDocs.length})` : ""}
          </h2>
          <LinkedDocsSection
            sourceId={id}
            initialLinks={linkedDocs.map((l) => ({
              id: l.id,
              position: l.position,
              target: l.target ? {
                id: l.target.id,
                title: l.target.title,
                description: l.target.description,
                slug: l.target.slug,
                body: l.target.versions[0]?.body ?? null,
              } : null,
            }))}
            canEdit={canEdit}
          />
        </section>
      )}

      {/* Version history */}
      {skill.versions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Version history
          </h2>
          <SkillVersionHistory
            skillId={id}
            versions={skill.versions.map((v) => ({
              id: v.id,
              versionNo: v.versionNo,
              body: v.body,
              changelog: v.changelog,
              createdAt: v.createdAt,
              files: v.files.map((f) => ({ id: f.id, path: f.path })),
            }))}
            currentVersionId={skill.currentVersionId}
            canEdit={canEdit}
          />
        </section>
      )}
    </div>
  );
}
