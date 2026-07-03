import { eq, and, sql } from "drizzle-orm";
import { artifactLinks } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";
import { createArtifact } from "@/server/services/artifact";

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
  return createArtifact(
    {
      kind: "plan",
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      title: input.title,
      slug: input.slug,
      description: input.description,
      tags: input.tags,
      visibility: input.visibility,
      body: input.body,
      changelog: input.changelog,
      createdBy: input.createdBy,
      tasks: input.tasks,
    },
    db,
  );
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
