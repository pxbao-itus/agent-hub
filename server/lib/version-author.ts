import { eq } from "drizzle-orm";
import { users } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";

/** Display name for whoever authored a version — falls back to email, then null. */
export async function getVersionAuthorName(userId: string | null | undefined, db: DbClient): Promise<string | null> {
  if (!userId) return null;
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { name: true, email: true },
  });
  return user?.name ?? user?.email ?? null;
}
