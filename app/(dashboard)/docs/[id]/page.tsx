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
import { slugify } from "@/lib/slug";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BodyViewer } from "@/components/ui/body-viewer";
import { McpUsage } from "@/components/ui/mcp-usage";
import { DeleteDocButton } from "../_components/delete-doc-button";
import { ShareDialog } from "../../_components/share-dialog";
import { FileText, ClipboardList, BookText, Wrench, Package } from "lucide-react";

const getDoc = cache(async (id: string) =>
  db.query.artifacts.findFirst({
    where: and(eq(artifacts.id, id), eq(artifacts.kind, "doc")),
    with: { versions: { orderBy: desc(artifactVersions.versionNo) } },
  }),
);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const doc = await getDoc(id);
  return { title: doc?.title ?? "Doc" };
}

const KIND_ICON: Record<string, React.ElementType> = {
  prompt: BookText,
  skill: Wrench,
  kit: Package,
  plan: ClipboardList,
  doc: FileText,
};
const KIND_HREF: Record<string, string> = {
  prompt: "/prompts",
  skill: "/skills",
  kit: "/kits",
  plan: "/plans",
  doc: "/docs",
};

export default async function DocDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const doc = await getDoc(id);
  if (!doc) notFound();

  const identity = { userId, systemRole: isSuperAdmin ? "superadmin" : "user" } as const;
  const accessible = await canAccessArtifact(identity, doc, db);
  if (!accessible) notFound();

  const canEdit = await canMutatePrompt(identity, doc, db);
  const canShare = await canShareArtifact(identity, doc, db);
  const currentVersion = doc.versions[0];

  const ownerPaths = await resolveOwnerSlugPaths(
    [{ ownerType: doc.ownerType, ownerId: doc.ownerId }],
    db,
  );
  const spacePath = ownerPaths.get(`${doc.ownerType}:${doc.ownerId}`) ?? "";
  const fullSlug = [spacePath, doc.slug ?? slugify(doc.title)].filter(Boolean).join(".");

  // "Referenced by" — plans that link to this doc
  const incomingLinks = await db.query.artifactLinks.findMany({
    where: and(eq(artifactLinks.targetArtifactId, id), eq(artifactLinks.relation, "doc")),
    orderBy: asc(artifactLinks.createdAt),
    with: { source: true },
  });

  // Filter to plans the current user can access
  const accessibleSources = [];
  for (const link of incomingLinks) {
    if (!link.source) continue;
    const ok = await canAccessArtifact(identity, link.source, db);
    if (ok) accessibleSources.push(link);
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">{doc.title}</h1>
            <Badge variant="secondary">doc</Badge>
            <Badge variant="outline">{doc.visibility}</Badge>
          </div>
          {doc.description && <p className="text-sm text-muted-foreground">{doc.description}</p>}
          {doc.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {doc.tags.map((tag) => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {canShare && <ShareDialog artifactId={id} artifactTitle={doc.title} />}
          {canEdit && (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={`/docs/${id}/edit`}>Edit</Link>
              </Button>
              <DeleteDocButton docId={id} />
            </>
          )}
        </div>
      </div>

      <McpUsage kind="doc" fullSlug={fullSlug} />

      {/* Body */}
      {currentVersion && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Content</h2>
            <span className="text-xs text-muted-foreground">v{currentVersion.versionNo}</span>
          </div>
          <BodyViewer body={currentVersion.body} defaultMode="rendered" />
        </section>
      )}

      {/* Referenced by */}
      {accessibleSources.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Referenced by ({accessibleSources.length})
          </h2>
          <div className="divide-y rounded-md border">
            {accessibleSources.map((link) => {
              const src = link.source!;
              const Icon = KIND_ICON[src.kind] ?? FileText;
              const href = `${KIND_HREF[src.kind] ?? "/"}/${src.id}`;
              return (
                <Link
                  key={link.id}
                  href={href}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{src.title}</p>
                    {src.description && (
                      <p className="truncate text-xs text-muted-foreground">{src.description}</p>
                    )}
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">{src.kind}</Badge>
                </Link>
              );
            })}
          </div>
          <div className="flex gap-2 pt-1">
            <Button asChild size="sm" variant="outline">
              <Link href={`/plans/new?linkDoc=${id}`}>Create plan from this doc</Link>
            </Button>
          </div>
        </section>
      )}

      {accessibleSources.length === 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Referenced by</h2>
          <p className="text-sm text-muted-foreground">No plans reference this doc yet.</p>
          <Button asChild size="sm" variant="outline">
            <Link href={`/plans/new?linkDoc=${id}`}>Create plan from this doc</Link>
          </Button>
        </section>
      )}

      {/* Version history */}
      {doc.versions.length > 1 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Version history</h2>
          <div className="divide-y rounded-md border text-sm">
            {doc.versions.map((v) => (
              <div key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="font-mono text-xs text-muted-foreground w-8">v{v.versionNo}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(v.createdAt).toLocaleDateString()}
                </span>
                {v.changelog && <span className="text-xs text-foreground truncate">{v.changelog}</span>}
                {v.id === doc.currentVersionId && (
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
