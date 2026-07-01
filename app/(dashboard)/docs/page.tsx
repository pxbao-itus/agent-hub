import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactVersions } from "@/server/db/schema";
import { desc, asc, eq, sql, and } from "drizzle-orm";
import { artifactAccessCondition } from "@/server/auth/access";
import { hybridSearch, fetchArtifactsByIds, sortArtifactRows } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FileText, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ListToolbar } from "@/components/ui/list-toolbar";

export const metadata: Metadata = { title: "Docs" };

type Props = {
  searchParams: Promise<{ q?: string; tag?: string; sort?: string; offset?: string }>;
};

export default async function DocsPage({ searchParams }: Props) {
  const { q, tag, sort, offset: offsetStr } = await searchParams;
  const offset = Number(offsetStr ?? 0);
  const limit = 30;

  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const accessWhere = await artifactAccessCondition(userId, isSuperAdmin ? "superadmin" : "user", db);
  const docWhere = and(eq(artifacts.kind, "doc"), accessWhere);
  const tagFilter = tag ? sql`${tag} = ANY(${artifacts.tags})` : undefined;

  let rows: Awaited<ReturnType<typeof fetchArtifactsByIds>>;
  let mode: "hybrid" | "keyword" = "keyword";
  if (q) {
    const res = await hybridSearch({
      query: q,
      accessCondition: docWhere,
      tagFilter,
      embedder: getEmbedder(),
      db,
      limit,
      offset,
    });
    mode = res.mode;
    rows = sortArtifactRows(await fetchArtifactsByIds(res.ids, db), sort ?? "relevant");
  } else {
    rows = await db.query.artifacts.findMany({
      where: and(docWhere, tagFilter),
      orderBy: sort === "title" ? asc(artifacts.title) : desc(artifacts.updatedAt),
      limit,
      offset,
      with: { versions: { limit: 1, orderBy: desc(artifactVersions.versionNo) } },
    });
  }

  const allDocs = await db.query.artifacts.findMany({ where: docWhere, columns: { tags: true } });
  const allTags = [...new Set(allDocs.flatMap((d) => d.tags))].sort();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Docs"
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
            <Link href="/docs/new">New doc</Link>
          </Button>
        }
      />

      <Suspense>
        <ListToolbar
          searchPlaceholder="Search docs…"
          hasQuery={!!q}
          extra={
            allTags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((t) => (
                  <Link key={t} href={tag === t ? "/docs" : `/docs?tag=${encodeURIComponent(t)}`}>
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
          icon={q || tag ? Search : FileText}
          variant={q || tag ? "no-results" : "empty"}
          message={q || tag ? "No docs match your search." : "No docs yet."}
          description={!q && !tag ? "Create your first doc to capture business requirements, bug descriptions, or domain knowledge." : undefined}
          action={!q && !tag ? (
            <Button asChild variant="outline"><Link href="/docs/new">Create your first doc</Link></Button>
          ) : undefined}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((doc) => {
            const body = doc.versions[0]?.body ?? "";
            const preview = body.slice(0, 120) + (body.length > 120 ? "…" : "");
            return (
              <Link key={doc.id} href={`/docs/${doc.id}`}>
                <Card className="h-full cursor-pointer transition-all hover:bg-muted/50 hover:shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <CardTitle className="text-sm leading-snug truncate">{doc.title}</CardTitle>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {doc.visibility}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {doc.description ? (
                      <p className="text-xs text-muted-foreground line-clamp-2">{doc.description}</p>
                    ) : preview ? (
                      <p className="line-clamp-3 font-mono text-xs text-muted-foreground">{preview}</p>
                    ) : null}
                    {doc.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {doc.tags.map((t) => (
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

      {(rows.length === limit || offset > 0) && (
        <div className="flex justify-center gap-2">
          {offset > 0 && (
            <Button asChild variant="outline" size="sm">
              <Link href={`?${new URLSearchParams({ ...(q ? { q } : {}), ...(tag ? { tag } : {}), ...(sort ? { sort } : {}), offset: String(Math.max(0, offset - limit)) })}`}>Previous</Link>
            </Button>
          )}
          {rows.length === limit && (
            <Button asChild variant="outline" size="sm">
              <Link href={`?${new URLSearchParams({ ...(q ? { q } : {}), ...(tag ? { tag } : {}), ...(sort ? { sort } : {}), offset: String(offset + limit) })}`}>Next</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
