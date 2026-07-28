import { eq } from "drizzle-orm";
import { users } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";

/**
 * Record a successful interactive login. Callers provide the timestamp so one
 * sign-in has one stable value and the database behavior is easy to test.
 *
 * This intentionally does not touch users.updatedAt: account-profile edits and
 * authentication recency are separate facts.
 */
export async function recordSuccessfulLogin(
  userId: string,
  signedInAt: Date,
  db: DbClient,
): Promise<void> {
  await db
    .update(users)
    .set({ lastLoginAt: signedInAt })
    .where(eq(users.id, userId));
}
