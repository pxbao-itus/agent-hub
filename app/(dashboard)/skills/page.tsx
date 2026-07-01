import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Skills" };
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
import { Wrench, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ListToolbar } from "@/components/ui/list-toolbar";

type Props = {
  searchParams: Promise<{ q?: string; tag?: string; sort?: string; offset?: string }>;
};

export default async function SkillsPage({ searchParams }: Props) {
  const { q, tag, sort, offset: offsetStr } = await searchParams;
  const offset = Number(offsetStr ?? 0);
  const limit = 30;

  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const accessWhere = await artifactAccessCondition(userId, isSuperAdmin ? "superadmin" : "user", db);
  const skillWhere = and(eq(artifacts.kind, "skill"), accessWhere);
  const tagFilter = tag ? sql`${tag} = ANY(${artifacts.tags})` : undefined;

  let rows: Awaited<ReturnType<typeof fetchArtifactsByIds>>;
  let mode: "hybrid" | "keyword" = "keyword";
  if (q) {
    const res = await hybridSearch({
      query: q,
      accessCondition: skillWhere,
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
      where: and(skillWhere, tagFilter),
      orderBy: sort === "title" ? asc(artifacts.title) : desc(artifacts.updatedAt),
      limit,
      offset,
      with: { versions: { limit: 1, orderBy: desc(artifactVersions.versionNo) } },
    });
  }

  const allSkills = await db.query.artifacts.findMany({ where: skillWhere, columns: { tags: true } });
  const allTags = [...new Set(allSkills.flatMap((s) => s.tags))].sort();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Skills"
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
            <Link href="/skills/new">New skill</Link>
          </Button>
        }
      />

      <Suspense>
        <ListToolbar
          searchPlaceholder="Search skills…"
          hasQuery={!!q}
          extra={
            allTags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((t) => (
                  <Link key={t} href={tag === t ? "/skills" : `/skills?tag=${encodeURIComponent(t)}`}>
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
          icon={q || tag ? Search : Wrench}
          variant={q || tag ? "no-results" : "empty"}
          message={q || tag ? "No skills match your search." : "No skills yet."}
          description={!q && !tag ? "Create your first skill to get started." : undefined}
          action={!q && !tag ? (
            <Button asChild variant="outline">
              <Link href="/skills/new">Create your first skill</Link>
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((skill) => {
            const currentBody = skill.versions[0]?.body ?? "";
            const preview = currentBody.slice(0, 120) + (currentBody.length > 120 ? "…" : "");
            return (
              <Link key={skill.id} href={`/skills/${skill.id}`}>
                <Card className="h-full cursor-pointer transition-all hover:bg-muted/50 hover:shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <CardTitle className="text-sm leading-snug truncate">{skill.title}</CardTitle>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {skill.visibility}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {preview && (
                      <p className="line-clamp-3 font-mono text-xs text-muted-foreground">{preview}</p>
                    )}
                    {skill.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {skill.tags.map((t) => (
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
