import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { prompts, promptVersions } from "@/server/db/schema";
import { desc, eq, or, sql, and } from "drizzle-orm";
import { getAccessibleGroups } from "@/server/auth/access";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PromptsPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  let where;
  if (isSuperAdmin) {
    where = undefined;
  } else {
    const groups = await getAccessibleGroups(userId, db);
    const groupConditions = groups.map((g) =>
      and(
        eq(prompts.visibility, "group"),
        eq(prompts.ownerType, g.groupType as "org" | "department" | "team"),
        eq(prompts.ownerId, g.groupId),
      ),
    );
    where = or(
      eq(prompts.visibility, "public"),
      and(eq(prompts.ownerType, "user"), eq(prompts.ownerId, userId)),
      ...(groupConditions.length > 0 ? groupConditions : [sql`false`]),
    );
  }

  const rows = await db.query.prompts.findMany({
    where,
    orderBy: desc(prompts.updatedAt),
    limit: 50,
    with: {
      versions: {
        limit: 1,
        orderBy: desc(promptVersions.versionNo),
      },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Prompts</h1>
          <p className="text-sm text-muted-foreground">{rows.length} prompt{rows.length !== 1 ? "s" : ""}</p>
        </div>
        <Button asChild>
          <Link href="/prompts/new">New prompt</Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No prompts yet.</p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/prompts/new">Create your first prompt</Link>
          </Button>
        </div>
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
                        {prompt.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
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
    </div>
  );
}
