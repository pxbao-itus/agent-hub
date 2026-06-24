import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { prompts, promptVersions } from "@/server/db/schema";
import { eq, desc } from "drizzle-orm";
import { getAccessibleGroups } from "@/server/auth/access";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeletePromptButton } from "./_components/delete-prompt-button";

export default async function PromptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const prompt = await db.query.prompts.findFirst({
    where: eq(prompts.id, id),
    with: {
      versions: { orderBy: desc(promptVersions.versionNo) },
      variables: true,
    },
  });
  if (!prompt) notFound();

  // Access check
  if (!isSuperAdmin && prompt.visibility !== "public") {
    const isOwner = prompt.ownerType === "user" && prompt.ownerId === userId;
    if (!isOwner) {
      if (prompt.visibility === "group") {
        const groups = await getAccessibleGroups(userId, db);
        const allowed = groups.some(
          (g) => g.groupType === prompt.ownerType && g.groupId === prompt.ownerId,
        );
        if (!allowed) notFound();
      } else {
        notFound();
      }
    }
  }

  const isOwner = (prompt.ownerType === "user" && prompt.ownerId === userId) || isSuperAdmin;
  const currentVersion = prompt.versions[0];

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
        {isOwner && (
          <div className="flex shrink-0 gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/prompts/${id}/edit`}>Edit</Link>
            </Button>
            <DeletePromptButton promptId={id} />
          </div>
        )}
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
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 font-mono text-sm whitespace-pre-wrap">
            {currentVersion.body}
          </pre>
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

      {/* Version history */}
      {prompt.versions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Version history
          </h2>
          <div className="divide-y rounded-md border">
            {prompt.versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="text-sm font-medium">v{v.versionNo}</span>
                  {v.changelog && (
                    <span className="ml-3 text-sm text-muted-foreground">{v.changelog}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(v.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
