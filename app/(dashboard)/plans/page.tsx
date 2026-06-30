import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactTasks } from "@/server/db/schema";
import { desc, eq, sql, and, inArray } from "drizzle-orm";
import { artifactAccessCondition } from "@/server/auth/access";
import { hybridSearch } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ClipboardList, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Plans" };

type Props = {
  searchParams: Promise<{ q?: string; tag?: string; offset?: string }>;
};

export default async function PlansPage({ searchParams }: Props) {
  const { q, tag, offset: offsetStr } = await searchParams;
  const offset = Number(offsetStr ?? 0);
  const limit = 30;

  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const accessWhere = await artifactAccessCondition(userId, isSuperAdmin ? "superadmin" : "user", db);
  const planWhere = and(eq(artifacts.kind, "plan"), accessWhere);
  const tagFilter = tag ? sql`${tag} = ANY(${artifacts.tags})` : undefined;

  const planWith = { tasks: { columns: { status: true } } } as const;

  let rows;
  if (q) {
    const { ids } = await hybridSearch({
      query: q,
      accessCondition: planWhere,
      tagFilter,
      embedder: getEmbedder(),
      db,
      limit,
      offset,
    });
    const found = ids.length
      ? await db.query.artifacts.findMany({ where: inArray(artifacts.id, ids), with: planWith })
      : [];
    const byId = new Map(found.map((r) => [r.id, r]));
    rows = ids.map((id) => byId.get(id)).filter(Boolean) as typeof found;
  } else {
    rows = await db.query.artifacts.findMany({
      where: and(planWhere, tagFilter),
      orderBy: desc(artifacts.updatedAt),
      limit,
      offset,
      with: planWith,
    });
  }

  const allPlans = await db.query.artifacts.findMany({ where: planWhere, columns: { tags: true } });
  const allTags = [...new Set(allPlans.flatMap((p) => p.tags))].sort();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Plans</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} result{rows.length !== 1 ? "s" : ""}
            {q ? ` for "${q}"` : ""}
          </p>
        </div>
        <Button asChild>
          <Link href="/plans/new">New plan</Link>
        </Button>
      </div>

      <form method="GET" className="flex gap-2">
        <Input name="q" defaultValue={q} placeholder="Search plans…" className="max-w-sm" />
        {q && (
          <Button asChild variant="ghost" size="sm">
            <Link href="/plans">Clear</Link>
          </Button>
        )}
      </form>

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((t) => (
            <Link key={t} href={tag === t ? "/plans" : `/plans?tag=${encodeURIComponent(t)}`}>
              <Badge variant={tag === t ? "default" : "secondary"} className="cursor-pointer text-[10px]">
                {t}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={q || tag ? Search : ClipboardList}
          variant={q || tag ? "no-results" : "empty"}
          message={q || tag ? "No plans match your search." : "No plans yet."}
          description={!q && !tag ? "Create your first plan to track progress." : undefined}
          action={!q && !tag ? (
            <Button asChild variant="outline">
              <Link href="/plans/new">Create your first plan</Link>
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((plan) => {
            const tasks = plan.tasks ?? [];
            const done = tasks.filter((t) => t.status === "done").length;
            const total = tasks.length;
            const pct = total > 0 ? Math.round((done / total) * 100) : null;

            return (
              <Link key={plan.id} href={`/plans/${plan.id}`}>
                <Card className="h-full cursor-pointer transition-all hover:bg-muted/50 hover:shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <ClipboardList className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <CardTitle className="text-sm leading-snug truncate">{plan.title}</CardTitle>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {plan.visibility}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {plan.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{plan.description}</p>
                    )}
                    {total > 0 && (
                      <div className="space-y-1">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground">{done}/{total} done</p>
                      </div>
                    )}
                    {plan.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {plan.tags.map((t) => (
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
