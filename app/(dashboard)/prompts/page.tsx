import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Prompts" };
import { auth } from "@/auth";
import { db } from "@/server/db";
import { prompts, promptVersions } from "@/server/db/schema";
import { desc, eq, or, sql, and } from "drizzle-orm";
import { getAccessibleGroups } from "@/server/auth/access";
import { hybridSearch, fetchPromptsByIds } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchBar } from "./_components/search-bar";
import { EmptyState } from "@/components/ui/empty-state";

type Props = {
  searchParams: Promise<{ q?: string; tag?: string; offset?: string }>;
};

export default async function PromptsPage({ searchParams }: Props) {
  const { q, tag, offset: offsetStr } = await searchParams;
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
        eq(prompts.visibility, "group"),
        eq(prompts.ownerType, g.groupType as "org" | "department" | "team"),
        eq(prompts.ownerId, g.groupId),
      ),
    );
    accessWhere = or(
      eq(prompts.visibility, "public"),
      and(eq(prompts.ownerType, "user"), eq(prompts.ownerId, userId)),
      ...(groupConditions.length > 0 ? groupConditions : [sql`false`]),
    );
  }

  const tagFilter = tag ? sql`${tag} = ANY(${prompts.tags})` : undefined;

  // ── Queries ────────────────────────────────────────────────────────────────
  let rows: Awaited<ReturnType<typeof fetchPromptsByIds>>;

  if (q) {
    const { ids } = await hybridSearch({
      query: q,
      accessCondition: accessWhere,
      tagFilter,
      embedder: getEmbedder(),
      db,
      limit,
      offset,
    });
    rows = await fetchPromptsByIds(ids, db);
  } else {
    const tagWhere = and(accessWhere, tagFilter);
    rows = await db.query.prompts.findMany({
      where: tagWhere,
      orderBy: desc(prompts.updatedAt),
      limit,
      offset,
      with: { versions: { limit: 1, orderBy: desc(promptVersions.versionNo) } },
    });
  }

  const [allPrompts] = await Promise.all([
    // Fetch all accessible tags for the filter bar
    db.query.prompts.findMany({
      where: accessWhere,
      columns: { tags: true },
    }),
  ]);

  const allTags = [...new Set(allPrompts.flatMap((p) => p.tags))].sort();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Prompts</h1>
          <p className="text-sm text-muted-foreground">{rows.length} result{rows.length !== 1 ? "s" : ""}{q ? ` for "${q}"` : ""}</p>
        </div>
        <Button asChild>
          <Link href="/prompts/new">New prompt</Link>
        </Button>
      </div>

      <Suspense>
        <SearchBar allTags={allTags} />
      </Suspense>

      {rows.length === 0 ? (
        <EmptyState
          message={q || tag ? "No prompts match your search." : "No prompts yet."}
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
                <Card className="h-full cursor-pointer transition-colors hover:bg-muted/50">
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
              <Link href={`?${new URLSearchParams({ ...(q ? { q } : {}), ...(tag ? { tag } : {}), offset: String(Math.max(0, offset - limit)) })}`}>
                Previous
              </Link>
            </Button>
          )}
          {rows.length === limit && (
            <Button asChild variant="outline" size="sm">
              <Link href={`?${new URLSearchParams({ ...(q ? { q } : {}), ...(tag ? { tag } : {}), offset: String(offset + limit) })}`}>
                Next
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
