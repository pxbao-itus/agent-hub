import { eq } from "drizzle-orm";
import {
  normalizeDashboardCardIds,
  type DashboardCardId,
} from "@/lib/dashboard-cards";
import { userDashboardPreferences } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";

export async function getDashboardCardLayout(
  userId: string,
  database: DbClient,
): Promise<DashboardCardId[]> {
  const preference = await database.query.userDashboardPreferences.findFirst({
    where: eq(userDashboardPreferences.userId, userId),
    columns: { cardIds: true },
  });
  return normalizeDashboardCardIds(preference?.cardIds);
}

export async function setDashboardCardLayout(
  userId: string,
  cardIds: DashboardCardId[],
  database: DbClient,
): Promise<DashboardCardId[]> {
  const now = new Date();
  const [preference] = await database
    .insert(userDashboardPreferences)
    .values({ userId, cardIds, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: userDashboardPreferences.userId,
      set: { cardIds, updatedAt: now },
    })
    .returning({ cardIds: userDashboardPreferences.cardIds });

  return normalizeDashboardCardIds(preference.cardIds);
}
