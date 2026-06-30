import { eq, and, sql } from "drizzle-orm";
import { artifacts, artifactVersions, artifactTasks, artifactLinks } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";

type TaskInput = { content: string; status?: "todo" | "doing" | "done"; position?: number };

export type CreatePlanInput = {
  title: string;
  slug?: string | null;
  description?: string;
  body: string;
  tasks?: TaskInput[];
  tags?: string[];
  visibility?: "private" | "group" | "public";
  ownerType: "user" | "org" | "department" | "team";
  ownerId: string;
  changelog?: string;
  createdBy: string;
};

/** Core plan creation — used by both tRPC plan.create and MCP create_plan. */
export async function createPlan(input: CreatePlanInput, db: DbClient) {
  const [plan] = await db
    .insert(artifacts)
    .values({
      kind: "plan",
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      title: input.title,
      slug: input.slug ?? null,
      description: input.description,
      tags: input.tags ?? [],
      visibility: input.visibility ?? "private",
      createdBy: input.createdBy,
    })
    .returning();

  const [version] = await db
    .insert(artifactVersions)
    .values({
      artifactId: plan.id,
      versionNo: 1,
      body: input.body,
      changelog: input.changelog ?? "Initial version",
      createdBy: input.createdBy,
    })
    .returning();

  if (input.tasks && input.tasks.length > 0) {
    await db.insert(artifactTasks).values(
      input.tasks.map((t, i) => ({
        artifactId: plan.id,
        content: t.content,
        status: (t.status ?? "todo") as "todo" | "doing" | "done",
        position: t.position ?? i,
      })),
    );
  }

  const [updated] = await db
    .update(artifacts)
    .set({ currentVersionId: version.id })
    .where(eq(artifacts.id, plan.id))
    .returning();

  return updated;
}

/** Attach a doc to a plan via artifact_links. No-op on duplicate. */
export async function addPlanLink(
  sourceId: string,
  targetId: string,
  createdBy: string,
  db: DbClient,
) {
  const [{ maxPos }] = await db
    .select({ maxPos: sql<number>`coalesce(max(position), -1)` })
    .from(artifactLinks)
    .where(and(eq(artifactLinks.sourceArtifactId, sourceId), eq(artifactLinks.relation, "doc")));

  await db
    .insert(artifactLinks)
    .values({
      sourceArtifactId: sourceId,
      targetArtifactId: targetId,
      relation: "doc",
      position: maxPos + 1,
      createdBy,
    })
    .onConflictDoNothing();
}
