import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Prompts" };
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactVersions } from "@/server/db/schema";
import { desc, asc, eq, or, sql, and } from "drizzle-orm";
import { getAccessibleGroups } from "@/server/auth/access";
import { hybridSearch, fetchArtifactsByIds, sortArtifactRows } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import { BookText, Search } from "lucide-react";

type Props = {
  searchParams: Promise<{ q?: string; tag?: string; sort?: string; offset?: string }>;
};

export default async function PromptsPage({ searchParams }: Props) {
  const { q, tag, sort, offset: offsetStr } = await searchParams;
  const offset = Number(offsetStr ?? 0);
  const limit = 30;

  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  // ── Access condition ───────────────────────────────────────────────────────
  let accessWhere;
  if (!isSuperAdmin) {
    const groups = await getAccessibleGroups(userId, db);
    const groupConditions = groups.map((g) =>
      and(
        eq(artifacts.visibility, "group"),
        eq(artifacts.ownerType, g.groupType as "org" | "department" | "team"),
        eq(artifacts.ownerId, g.groupId),
      ),
    );
    accessWhere = or(
      eq(artifacts.visibility, "public"),
      and(eq(artifacts.ownerType, "user"), eq(artifacts.ownerId, userId)),
      ...(groupConditions.length > 0 ? groupConditions : [sql`false`]),
    );
  }

  // Forward-compat: this page lists prompt-kind artifacts only.
  const promptWhere = and(eq(artifacts.kind, "prompt"), accessWhere);
  const tagFilter = tag ? sql`${tag} = ANY(${artifacts.tags})` : undefined;

  // ── Queries ────────────────────────────────────────────────────────────────
  let rows: Awaited<ReturnType<typeof fetchArtifactsByIds>>;
  let mode: "hybrid" | "keyword" = "keyword";

  if (q) {
    const res = await hybridSearch({
      query: q,
      accessCondition: promptWhere,
      tagFilter,
      embedder: getEmbedder(),
      db,
      limit,
      offset,
    });
    mode = res.mode;
    rows = sortArtifactRows(await fetchArtifactsByIds(res.ids, db), sort ?? "relevant");
  } else {
    const tagWhere = and(promptWhere, tagFilter);
    rows = await db.query.artifacts.findMany({
      where: tagWhere,
      orderBy: sort === "title" ? asc(artifacts.title) : desc(artifacts.updatedAt),
      limit,
      offset,
      with: { versions: { limit: 1, orderBy: desc(artifactVersions.versionNo) } },
    });
  }

  const [allPrompts] = await Promise.all([
    // Fetch all accessible tags for the filter bar
    db.query.artifacts.findMany({
      where: promptWhere,
      columns: { tags: true },
    }),
  ]);

  const allTags = [...new Set(allPrompts.flatMap((p) => p.tags))].sort();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prompts"
        description={`${rows.length} result${rows.length !== 1 ? "s" : ""}${q ? ` for "${q}"` : ""}`}
        badge={
          q ? (
            <Badge variant="outline" className="ml-2 text-[10px] align-middle">
              {mode === "hybrid" ? "semantic" : "keyword"}
            </Badge>
          ) : undefined
        }
        actions={
          <Button asChild>
            <Link href="/prompts/new">New prompt</Link>
          </Button>
        }
      />

      <Suspense>
        <ListToolbar
          searchPlaceholder="Search prompts…"
          hasQuery={!!q}
          extra={
            allTags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-muted-foreground self-center">Filter:</span>
                {allTags.map((t) => (
                  <Link key={t} href={tag === t ? "/prompts" : `/prompts?tag=${encodeURIComponent(t)}`}>
                    <Badge variant={tag === t ? "default" : "secondary"} className="cursor-pointer text-[10px]">
                      {t}
                    </Badge>
                  </Link>
                ))}
              </div>
            ) : undefined
          }
        />
      </Suspense>

      {rows.length === 0 ? (
        <EmptyState
          icon={q || tag ? Search : BookText}
          variant={q || tag ? "no-results" : "empty"}
          message={q || tag ? "No prompts match your search." : "No prompts yet."}
          description={!q && !tag ? "Create your first prompt to get started." : undefined}
          action={!q && !tag ? (
            <Button asChild variant="outline">
              <Link href="/prompts/new">Create your first prompt</Link>
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((prompt) => {
            const currentBody = prompt.versions[0]?.body ?? "";
            const preview = currentBody.slice(0, 120) + (currentBody.length > 120 ? "…" : "");
            return (
              <Link key={prompt.id} href={`/prompts/${prompt.id}`}>
                <Card className="h-full cursor-pointer transition-all hover:bg-muted/50 hover:shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm leading-snug">{prompt.title}</CardTitle>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {prompt.visibility}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {preview && (
                      <p className="line-clamp-3 font-mono text-xs text-muted-foreground">{preview}</p>
                    )}
                    {prompt.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {prompt.tags.map((t) => (
                          <Badge key={t} variant={t === tag ? "default" : "secondary"} className="text-[10px]">{t}</Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {(rows.length === limit || offset > 0) && (
        <div className="flex justify-center gap-2">
          {offset > 0 && (
            <Button asChild variant="outline" size="sm">
              <Link href={`?${new URLSearchParams({ ...(q ? { q } : {}), ...(tag ? { tag } : {}), ...(sort ? { sort } : {}), offset: String(Math.max(0, offset - limit)) })}`}>
                Previous
              </Link>
            </Button>
          )}
          {rows.length === limit && (
            <Button asChild variant="outline" size="sm">
              <Link href={`?${new URLSearchParams({ ...(q ? { q } : {}), ...(tag ? { tag } : {}), ...(sort ? { sort } : {}), offset: String(offset + limit) })}`}>
                Next
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
