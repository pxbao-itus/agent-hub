import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { artifactAccessCondition } from "@/server/auth/access";
import { hybridSearch, fetchArtifactsByIds } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BookText, Wrench, Package, ClipboardList, FileText, Search } from "lucide-react";

export const metadata: Metadata = { title: "Search" };

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
const KIND_LABEL: Record<string, string> = {
  prompt: "Prompts",
  skill: "Skills",
  kit: "Kits",
  plan: "Plans",
  doc: "Docs",
};
const KIND_ORDER = ["prompt", "skill", "kit", "plan", "doc"] as const;

type Props = {
  searchParams: Promise<{ q?: string; kind?: string }>;
};

export default async function SearchPage({ searchParams }: Props) {
  const { q, kind } = await searchParams;

  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const validKind = (KIND_ORDER as readonly string[]).includes(kind ?? "")
    ? (kind as (typeof KIND_ORDER)[number])
    : undefined;

  const accessWhere = await artifactAccessCondition(userId, isSuperAdmin ? "superadmin" : "user", db);
  const accessCondition = validKind ? and(eq(artifacts.kind, validKind), accessWhere) : accessWhere;

  let rows: Awaited<ReturnType<typeof fetchArtifactsByIds>> = [];
  let mode: "hybrid" | "keyword" = "keyword";
  if (q) {
    const res = await hybridSearch({
      query: q,
      accessCondition,
      embedder: getEmbedder(),
      db,
      limit: 60,
      offset: 0,
    });
    mode = res.mode;
    rows = await fetchArtifactsByIds(res.ids, db);
  }

  // Group results by kind, preserving the canonical kind order.
  const grouped = KIND_ORDER.map((k) => ({
    kind: k,
    items: rows.filter((r) => r.kind === k),
  })).filter((g) => g.items.length > 0);

  function buildHref(k?: string) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (k) params.set("kind", k);
    const s = params.toString();
    return `/search${s ? `?${s}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Search</h1>
        <p className="text-sm text-muted-foreground">
          Search across everything you can access — prompts, skills, kits, plans, docs.
          {q && (
            <>
              {" "}
              {rows.length} result{rows.length !== 1 ? "s" : ""} for &quot;{q}&quot;
              <Badge variant="outline" className="ml-2 text-[10px] align-middle">
                {mode === "hybrid" ? "semantic" : "keyword"}
              </Badge>
            </>
          )}
        </p>
      </div>

      {/* Search box + kind tabs */}
      <div className="space-y-3">
        <form method="GET" className="flex gap-2">
          <Input name="q" defaultValue={q} placeholder="Search everything…" className="max-w-sm" autoFocus />
          {validKind && <input type="hidden" name="kind" value={validKind} />}
          <Button type="submit" size="sm">Search</Button>
          {q && (
            <Button asChild variant="ghost" size="sm">
              <Link href={buildHref(validKind)}>Clear</Link>
            </Button>
          )}
        </form>

        {q && (
          <div className="flex flex-wrap gap-1.5">
            {(["", ...KIND_ORDER] as const).map((k) => {
              const label = k === "" ? "All" : KIND_LABEL[k];
              const active = (k === "" && !validKind) || k === validKind;
              return (
                <Link key={k || "all"} href={buildHref(k || undefined)}>
                  <Badge variant={active ? "default" : "secondary"} className="cursor-pointer text-[11px] py-1">
                    {label}
                  </Badge>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {!q ? (
        <EmptyState icon={Search} variant="empty" message="Type a query to search." />
      ) : rows.length === 0 ? (
        <EmptyState icon={Search} variant="no-results" message="No artifacts match your search." />
      ) : (
        <div className="space-y-8">
          {grouped.map((group) => {
            const Icon = KIND_ICON[group.kind];
            return (
              <section key={group.kind} className="space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-4 w-4" />
                  {KIND_LABEL[group.kind]} ({group.items.length})
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((artifact) => {
                    const href = `${KIND_HREF[artifact.kind]}/${artifact.id}`;
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
                              <Badge variant="outline" className="shrink-0 text-[10px]">{artifact.visibility}</Badge>
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
                                  <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                                ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
