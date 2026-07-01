import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactVersions, artifactLinks } from "@/server/db/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { canAccessArtifact, canMutatePrompt, canShareArtifact } from "@/server/auth/access";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeletePromptButton } from "./_components/delete-prompt-button";
import { VersionHistory } from "./_components/version-history";
import { BodyViewer } from "@/components/ui/body-viewer";
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
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{prompt.title}</h1>
            <Badge variant="outline">{prompt.visibility}</Badge>
          </div>
          {prompt.description && (
            <p className="text-sm text-muted-foreground">{prompt.description}</p>
          )}
          {prompt.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {prompt.tags.map((tag) => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
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

      {/* Current body */}
      {currentVersion && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Prompt body
            </h2>
            <span className="text-xs text-muted-foreground">v{currentVersion.versionNo}</span>
          </div>
          <BodyViewer body={currentVersion.body} defaultMode="raw" />
        </section>
      )}

      {/* Variables */}
      {prompt.variables.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Variables</h2>
          <div className="divide-y rounded-md border">
            {prompt.variables.map((v) => (
              <div key={v.id} className="flex items-center justify-between px-4 py-2.5">
                <code className="text-sm font-mono">{"{{" + v.name + "}}"}</code>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {v.defaultValue && <span>default: {v.defaultValue}</span>}
                  {v.required && <Badge variant="outline">required</Badge>}
                </div>
              </div>
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
      {prompt.versions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Version history
          </h2>
          <VersionHistory
            promptId={id}
            versions={prompt.versions}
            currentVersionId={prompt.currentVersionId}
            canEdit={canEdit}
          />
        </section>
      )}
    </div>
  );
}
