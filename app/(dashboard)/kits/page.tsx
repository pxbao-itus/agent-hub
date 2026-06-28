import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactVersions } from "@/server/db/schema";
import { desc, eq, or, sql, and } from "drizzle-orm";
import { getAccessibleGroups } from "@/server/auth/access";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Package, Search } from "lucide-react";

export const metadata: Metadata = { title: "Kits" };

type Props = {
  searchParams: Promise<{ q?: string; tag?: string; offset?: string }>;
};

export default async function KitsPage({ searchParams }: Props) {
  const { q, tag, offset: offsetStr } = await searchParams;
  const offset = Number(offsetStr ?? 0);
  const limit = 30;

  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

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

  const kitWhere = and(eq(artifacts.kind, "kit"), accessWhere);
  const tagFilter = tag ? sql`${tag} = ANY(${artifacts.tags})` : undefined;
  const ftsFilter = q
    ? sql`to_tsvector('english', ${artifacts.title} || ' ' || coalesce(${artifacts.description}, '')) @@ plainto_tsquery('english', ${q})`
    : undefined;

  const where = and(kitWhere, ftsFilter, tagFilter);

  const [rows, allKits] = await Promise.all([
    db.query.artifacts.findMany({
      where,
      orderBy: desc(artifacts.updatedAt),
      limit,
      offset,
      with: {
        versions: { limit: 1, orderBy: desc(artifactVersions.versionNo) },
        members: true,
      },
    }),
    db.query.artifacts.findMany({
      where: kitWhere,
      columns: { tags: true },
    }),
  ]);

  const allTags = [...new Set(allKits.flatMap((k) => k.tags))].sort();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Kits</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} result{rows.length !== 1 ? "s" : ""}
            {q ? ` for "${q}"` : ""}
          </p>
        </div>
        <Button asChild>
          <Link href="/kits/new">New kit</Link>
        </Button>
      </div>

      {/* Search */}
      <form method="GET" className="flex gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search kits…"
          className="max-w-sm"
        />
        {q && (
          <Button asChild variant="ghost" size="sm">
            <Link href="/kits">Clear</Link>
          </Button>
        )}
      </form>

      {/* Tag filters */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((t) => (
            <Link key={t} href={tag === t ? "/kits" : `/kits?tag=${encodeURIComponent(t)}`}>
              <Badge variant={tag === t ? "default" : "secondary"} className="cursor-pointer text-[10px]">
                {t}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={q || tag ? Search : Package}
          variant={q || tag ? "no-results" : "empty"}
          message={q || tag ? "No kits match your search." : "No kits yet."}
          description={!q && !tag ? "Bundle prompts and skills into a kit." : undefined}
          action={!q && !tag ? (
            <Button asChild variant="outline">
              <Link href="/kits/new">Create your first kit</Link>
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((kit) => {
            const memberCount = kit.members.length;
            return (
              <Link key={kit.id} href={`/kits/${kit.id}`}>
                <Card className="h-full cursor-pointer transition-all hover:bg-muted/50 hover:shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
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
