import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { createTestDb } from "@/server/test-support/test-db";
import { userRouter } from "./user";
import type { Context } from "@/server/trpc/context";

const { db, close } = createTestDb();
const createdUserIds: string[] = [];
let superadmin: typeof schema.users.$inferSelect;
let normalUser: typeof schema.users.$inferSelect;

beforeAll(async () => {
  superadmin = (await db.query.users.findFirst({ where: eq(schema.users.email, "superadmin@test.local") }))!;
  normalUser = (await db.query.users.findFirst({ where: eq(schema.users.email, "eng-member@test.local") }))!;
});

afterAll(async () => {
  if (createdUserIds.length) {
    await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
  }
  await close();
});

function caller(user: typeof schema.users.$inferSelect) {
  const ctx: Context = {
    db,
    session: { userId: user.id, systemRole: user.systemRole },
  };
  return userRouter.createCaller(ctx);
}

describe("user username contract", () => {
  it("requires a unique canonical immutable username on admin-created users", async () => {
    const username = `phaseuser${Date.now()}`;
    const admin = caller(superadmin);
    const created = await admin.create({
      name: "Phase User",
      username,
      email: `${username}@test.local`,
      systemRole: "user",
    });
    createdUserIds.push(created.id);
    expect(created.username).toBe(username);

    const matches = await admin.search({ query: username, limit: 10 });
    expect(matches.some((user) => user.id === created.id && user.username === username)).toBe(true);

    await expect(
      admin.create({
        username,
        email: `${username}2@test.local`,
        systemRole: "user",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      admin.create({
        username: "Invalid_Name",
        email: `invalid-${username}@test.local`,
        systemRole: "user",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(
      admin.update({ userId: created.id, username: "renameduser" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("keeps user creation superadmin-only", async () => {
    await expect(
      caller(normalUser).create({
        username: `forbidden${Date.now()}`,
        email: `forbidden-${Date.now()}@test.local`,
        systemRole: "user",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

