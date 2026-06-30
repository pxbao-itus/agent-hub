import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db";
import { artifacts, artifactVersions } from "@/server/db/schema";
import { desc, eq, sql, and } from "drizzle-orm";
import { hybridSearch, fetchArtifactsByIds } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { BookText, Wrench, Package, ClipboardList, FileText, Compass, Search } from "lucide-react";

export const metadata: Metadata = { title: "Explore" };

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

type Props = {
  searchParams: Promise<{ q?: string; kind?: string; tag?: string; offset?: string }>;
};

export default async function ExplorePage({ searchParams }: Props) {
  const { q, kind, tag, offset: offsetStr } = await searchParams;
  const offset = Number(offsetStr ?? 0);
  const limit = 30;

  const validKind = kind === "prompt" || kind === "skill" || kind === "kit" || kind === "plan" || kind === "doc" ? kind : undefined;

  // Public artifacts from any owner
  const publicWhere = eq(artifacts.visibility, "public");
  const kindFilter = validKind ? eq(artifacts.kind, validKind) : undefined;
  const tagFilter = tag ? sql`${tag} = ANY(${artifacts.tags})` : undefined;

  let rows: Awaited<ReturnType<typeof fetchArtifactsByIds>>;
  if (q) {
    const { ids } = await hybridSearch({
      query: q,
      accessCondition: and(publicWhere, kindFilter),
      tagFilter,
      embedder: getEmbedder(),
      db,
      limit,
      offset,
    });
    rows = await fetchArtifactsByIds(ids, db);
  } else {
    rows = await db.query.artifacts.findMany({
      where: and(publicWhere, kindFilter, tagFilter),
      orderBy: desc(artifacts.updatedAt),
      limit,
      offset,
      with: { versions: { limit: 1, orderBy: desc(artifactVersions.versionNo) } },
    });
  }

  const allPublic = await db.query.artifacts.findMany({
    where: and(publicWhere, kindFilter),
    columns: { tags: true },
  });
  const allTags = [...new Set(allPublic.flatMap((a) => a.tags))].sort();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Explore</h1>
        <p className="text-sm text-muted-foreground">
          Browse public artifacts from the community.
          {rows.length > 0 && ` ${rows.length} result${rows.length !== 1 ? "s" : ""}${q ? ` for "${q}"` : ""}.`}
        </p>
      </div>

      {/* Search + kind filter */}
      <div className="space-y-3">
        <form method="GET" className="flex gap-2">
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search public artifacts…"
            className="max-w-sm"
          />
          {kind && <input type="hidden" name="kind" value={kind} />}
          {tag && <input type="hidden" name="tag" value={tag} />}
          {q && (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/explore${kind ? `?kind=${kind}` : ""}`}>Clear</Link>
            </Button>
          )}
        </form>

        {/* Kind tabs */}
        <div className="flex gap-1.5">
          {(["", "prompt", "skill", "kit", "plan", "doc"] as const).map((k) => {
            const label = k === "" ? "All" : k.charAt(0).toUpperCase() + k.slice(1) + "s";
            const href = k
              ? `/explore?kind=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`
              : `/explore${q ? `?q=${encodeURIComponent(q)}` : ""}`;
            const active = (k === "" && !validKind) || k === validKind;
            return (
              <Link key={k} href={href}>
                <Badge
                  variant={active ? "default" : "secondary"}
                  className="cursor-pointer text-[11px] py-1"
                >
                  {label}
                </Badge>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Tag filters */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((t) => {
            const tagHref = tag === t
              ? `/explore${validKind ? `?kind=${validKind}` : ""}${q ? `${validKind ? "&" : "?"}q=${encodeURIComponent(q)}` : ""}`
              : `/explore?tag=${encodeURIComponent(t)}${validKind ? `&kind=${validKind}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
            return (
              <Link key={t} href={tagHref}>
                <Badge variant={tag === t ? "default" : "outline"} className="cursor-pointer text-[10px]">
                  {t}
                </Badge>
              </Link>
            );
          })}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={q || validKind || tag ? Search : Compass}
          variant={q || validKind || tag ? "no-results" : "empty"}
          message={q || validKind || tag ? "No public artifacts match." : "No public artifacts yet."}
          description={!q && !validKind && !tag ? "Public artifacts will appear here." : undefined}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((artifact) => {
            const Icon = KIND_ICON[artifact.kind] ?? BookText;
            const href = `${KIND_HREF[artifact.kind] ?? "/prompts"}/${artifact.id}`;
            const body = artifact.versions[0]?.body ?? "";
            const preview = body.slice(0, 100) + (body.length > 100 ? "…" : "");
            return (
              <Link key={artifact.id} href={href}>
                <Card className="h-full cursor-pointer transition-all hover:bg-muted/50 hover:shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <CardTitle className="text-sm leading-snug truncate">{artifact.title}</CardTitle>
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {artifact.kind}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {artifact.description ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{artifact.description}</p>
                    ) : preview ? (
                      <p className="line-clamp-2 font-mono text-xs text-muted-foreground">{preview}</p>
                    ) : null}
                    {artifact.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {artifact.tags.map((t) => (
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
              <Link href={`?${new URLSearchParams({ ...(q ? { q } : {}), ...(validKind ? { kind: validKind } : {}), ...(tag ? { tag } : {}), offset: String(Math.max(0, offset - limit)) })}`}>
                Previous
              </Link>
            </Button>
          )}
          {rows.length === limit && (
            <Button asChild variant="outline" size="sm">
              <Link href={`?${new URLSearchParams({ ...(q ? { q } : {}), ...(validKind ? { kind: validKind } : {}), ...(tag ? { tag } : {}), offset: String(offset + limit) })}`}>
                Next
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
