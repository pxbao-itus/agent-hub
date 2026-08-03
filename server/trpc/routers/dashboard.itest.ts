import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { createTestDb } from "@/server/test-support/test-db";
import type { Context } from "@/server/trpc/context";
import { DASHBOARD_CARD_IDS } from "@/lib/dashboard-cards";
import { dashboardRouter } from "./dashboard";

const { db, close } = createTestDb();
let firstUser: typeof schema.users.$inferSelect;
let secondUser: typeof schema.users.$inferSelect;

beforeAll(async () => {
  firstUser = (await db.query.users.findFirst({
    where: eq(schema.users.email, "eng-member@test.local"),
  }))!;
  secondUser = (await db.query.users.findFirst({
    where: eq(schema.users.email, "outsider@test.local"),
  }))!;
  await db
    .delete(schema.userDashboardPreferences)
    .where(inArray(schema.userDashboardPreferences.userId, [firstUser.id, secondUser.id]));
});

afterAll(async () => {
  await db
    .delete(schema.userDashboardPreferences)
    .where(inArray(schema.userDashboardPreferences.userId, [firstUser.id, secondUser.id]));
  await close();
});

function caller(user: typeof schema.users.$inferSelect) {
  const ctx: Context = {
    db,
    session: { userId: user.id, systemRole: user.systemRole },
  };
  return dashboardRouter.createCaller(ctx);
}

describe("dashboard card preferences", () => {
  it("returns the complete default when no preference row exists", async () => {
    await expect(caller(firstUser).getLayout()).resolves.toEqual(DASHBOARD_CARD_IDS);
  });

  it("creates, reorders, subsets and empties one persistent user row", async () => {
    const firstSave = await caller(firstUser).updateLayout({
      cardIds: ["skills", "prompts", "mcp_tokens"],
    });
    expect(firstSave).toEqual(["skills", "prompts", "mcp_tokens"]);

    await expect(caller(firstUser).getLayout()).resolves.toEqual([
      "skills",
      "prompts",
      "mcp_tokens",
    ]);

    await expect(caller(firstUser).updateLayout({ cardIds: [] })).resolves.toEqual([]);
    await expect(caller(firstUser).getLayout()).resolves.toEqual([]);

    const rows = await db.query.userDashboardPreferences.findMany({
      where: eq(schema.userDashboardPreferences.userId, firstUser.id),
    });
    expect(rows).toHaveLength(1);
  });

  it("isolates layouts by the session user", async () => {
    await caller(firstUser).updateLayout({ cardIds: ["docs"] });
    await expect(caller(secondUser).getLayout()).resolves.toEqual(DASHBOARD_CARD_IDS);
    await caller(secondUser).updateLayout({ cardIds: ["organizations", "plans"] });
    await expect(caller(firstUser).getLayout()).resolves.toEqual(["docs"]);
    await expect(caller(secondUser).getLayout()).resolves.toEqual(["organizations", "plans"]);
  });

  it("rejects unknown, duplicate and oversized inputs", async () => {
    const api = caller(firstUser);
    await expect(api.updateLayout({ cardIds: ["retired"] as never })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(api.updateLayout({ cardIds: ["docs", "docs"] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      api.updateLayout({
        cardIds: [
          "prompts",
          "skills",
          "plans",
          "docs",
          "organizations",
          "mcp_tokens",
          "prompts",
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("defensively ignores unsupported stored IDs", async () => {
    await db
      .insert(schema.userDashboardPreferences)
      .values({ userId: firstUser.id, cardIds: ["retired", "skills", "skills", "docs"] })
      .onConflictDoUpdate({
        target: schema.userDashboardPreferences.userId,
        set: { cardIds: ["retired", "skills", "skills", "docs"] },
      });
    await expect(caller(firstUser).getLayout()).resolves.toEqual(["skills", "docs"]);
  });

  it("deletes the preference when its user is deleted", async () => {
    const [temporaryUser] = await db
      .insert(schema.users)
      .values({ email: `dashboard-cascade-${Date.now()}@test.local` })
      .returning();
    await db
      .insert(schema.userDashboardPreferences)
      .values({ userId: temporaryUser.id, cardIds: ["prompts"] });

    await db.delete(schema.users).where(eq(schema.users.id, temporaryUser.id));
    const preference = await db.query.userDashboardPreferences.findFirst({
      where: eq(schema.userDashboardPreferences.userId, temporaryUser.id),
    });
    expect(preference).toBeUndefined();
  });
});
