import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactVersions } from "@/server/db/schema";
import { desc, asc, eq, sql, and, inArray } from "drizzle-orm";
import { artifactAccessCondition } from "@/server/auth/access";
import { hybridSearch, sortArtifactRows } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Package, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { ListSelectionProvider } from "@/components/ui/list-selection-context";
import { SelectableItem } from "@/components/ui/selectable-item";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";

export const metadata: Metadata = { title: "Kits" };

type Props = {
  searchParams: Promise<{ q?: string; tag?: string; sort?: string; offset?: string }>;
};

export default async function KitsPage({ searchParams }: Props) {
  const { q, tag, sort, offset: offsetStr } = await searchParams;
  const offset = Number(offsetStr ?? 0);
  const limit = 30;

  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const accessWhere = await artifactAccessCondition(userId, isSuperAdmin ? "superadmin" : "user", db);
  const kitWhere = and(eq(artifacts.kind, "kit"), accessWhere);
  const tagFilter = tag ? sql`${tag} = ANY(${artifacts.tags})` : undefined;

  const kitWith = {
    versions: { limit: 1, orderBy: desc(artifactVersions.versionNo) },
    members: true,
  } as const;

  let rows;
  let mode: "hybrid" | "keyword" = "keyword";
  if (q) {
    const res = await hybridSearch({
      query: q,
      accessCondition: kitWhere,
      tagFilter,
      embedder: getEmbedder(),
      db,
      limit,
      offset,
    });
    mode = res.mode;
    const found = res.ids.length
      ? await db.query.artifacts.findMany({ where: inArray(artifacts.id, res.ids), with: kitWith })
      : [];
    const byId = new Map(found.map((r) => [r.id, r]));
    rows = sortArtifactRows(res.ids.map((id) => byId.get(id)).filter(Boolean) as typeof found, sort ?? "relevant");
  } else {
    rows = await db.query.artifacts.findMany({
      where: and(kitWhere, tagFilter),
      orderBy: sort === "title" ? asc(artifacts.title) : desc(artifacts.updatedAt),
      limit,
      offset,
      with: kitWith,
    });
  }

  const allKits = await db.query.artifacts.findMany({ where: kitWhere, columns: { tags: true } });
  const allTags = [...new Set(allKits.flatMap((k) => k.tags))].sort();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kits"
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
            <Link href="/kits/new">New kit</Link>
          </Button>
        }
      />

      <Suspense>
        <ListToolbar
          searchPlaceholder="Search kits…"
          hasQuery={!!q}
          extra={
            allTags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((t) => (
                  <Link key={t} href={tag === t ? "/kits" : `/kits?tag=${encodeURIComponent(t)}`}>
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
          icon={q || tag ? Search : Package}
          variant={q || tag ? "no-results" : "empty"}
          message={q || tag ? "No kits match your search." : "No kits yet."}
          description={!q && !tag ? "Toolkits package prompts and skills for reuse across projects and workflows." : undefined}
          action={!q && !tag ? (
            <Button asChild variant="outline">
              <Link href="/kits/new">Create your first kit</Link>
            </Button>
          ) : undefined}
        />
      ) : (
        <ListSelectionProvider>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((kit) => {
              const memberCount = kit.members.length;
              return (
                <SelectableItem key={kit.id} id={kit.id} label={kit.title}>
                  <Link href={`/kits/${kit.id}`}>
                    <Card className="h-full cursor-pointer transition-all hover:bg-muted/50 hover:shadow-sm">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2 pl-5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <CardTitle className="text-sm leading-snug truncate">{kit.title}</CardTitle>
                          </div>
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {kit.visibility}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {kit.description && (
                          <p className="line-clamp-2 text-xs text-muted-foreground">{kit.description}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {memberCount} member{memberCount !== 1 ? "s" : ""}
                        </p>
                        {kit.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {kit.tags.map((t) => (
                              <Badge key={t} variant={t === tag ? "default" : "secondary"} className="text-[10px]">{t}</Badge>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                </SelectableItem>
              );
            })}
          </div>
          <BulkActionBar kind="kit" />
        </ListSelectionProvider>
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
