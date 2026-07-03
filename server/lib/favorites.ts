import { and, eq } from "drizzle-orm";
import { artifactFavorites } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";

export async function isFavorited(userId: string, artifactId: string, db: DbClient): Promise<boolean> {
  const row = await db.query.artifactFavorites.findFirst({
    where: and(eq(artifactFavorites.userId, userId), eq(artifactFavorites.artifactId, artifactId)),
    columns: { id: true },
  });
  return !!row;
}
