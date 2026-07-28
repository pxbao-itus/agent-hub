import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { createTestDb } from "@/server/test-support/test-db";
import { userRouter } from "./user";
import type { Context } from "@/server/trpc/context";
import { recordSuccessfulLogin } from "@/server/auth/last-login";

const { db, close } = createTestDb();
const createdUserIds: string[] = [];
const createdArtifactIds: string[] = [];
let superadmin: typeof schema.users.$inferSelect;
let normalUser: typeof schema.users.$inferSelect;
let outsider: typeof schema.users.$inferSelect;

beforeAll(async () => {
  superadmin = (await db.query.users.findFirst({ where: eq(schema.users.email, "superadmin@test.local") }))!;
  normalUser = (await db.query.users.findFirst({ where: eq(schema.users.email, "eng-member@test.local") }))!;
  outsider = (await db.query.users.findFirst({ where: eq(schema.users.email, "outsider@test.local") }))!;
});

afterAll(async () => {
  if (createdArtifactIds.length) {
    await db.delete(schema.artifacts).where(inArray(schema.artifacts.id, createdArtifactIds));
  }
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

describe("user last-login tracking", () => {
  it("stores the supplied successful-login timestamp without changing profile recency", async () => {
    const before = await db.query.users.findFirst({
      where: eq(schema.users.id, normalUser.id),
      columns: { updatedAt: true },
    });
    const signedInAt = new Date("2026-07-28T08:30:00.000Z");

    await recordSuccessfulLogin(normalUser.id, signedInAt, db);

    const after = await db.query.users.findFirst({
      where: eq(schema.users.id, normalUser.id),
      columns: { lastLoginAt: true, updatedAt: true },
    });
    expect(after?.lastLoginAt?.toISOString()).toBe(signedInAt.toISOString());
    expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
  });
});

describe("user profiles", () => {
  it("allows regular users to view safe profile and membership facts", async () => {
    const profile = await caller(outsider).getProfile({ userId: normalUser.id });

    expect(profile.user.email).toBe(normalUser.email);
    expect(profile.admin).toBeUndefined();
    expect(profile.memberships).toHaveLength(1);
    expect(profile.memberships[0]?.departments[0]?.teams[0]?.direct).not.toBeNull();
    expect(profile.memberships[0]?.href).toBeNull();
  });

  it("returns authentication summaries only to superadmins", async () => {
    const profile = await caller(superadmin).getProfile({ userId: normalUser.id });
    expect(profile.admin?.hasPassword).toBe(true);
    expect(profile.admin?.authMethods).toContain("credentials");
  });

  it("filters private target activity by the viewer's access", async () => {
    const [artifact] = await db
      .insert(schema.artifacts)
      .values({
        kind: "doc",
        ownerType: "user",
        ownerId: normalUser.id,
        title: "Private profile activity",
        visibility: "private",
        createdBy: normalUser.id,
      })
      .returning();
    createdArtifactIds.push(artifact.id);
    const [version] = await db
      .insert(schema.artifactVersions)
      .values({
        artifactId: artifact.id,
        versionNo: 1,
        body: "Private",
        createdBy: normalUser.id,
      })
      .returning();
    await db
      .update(schema.artifacts)
      .set({ currentVersionId: version.id })
      .where(eq(schema.artifacts.id, artifact.id));

    const ownActivity = await caller(normalUser).listActivity({
      userId: normalUser.id,
      filter: "content",
      limit: 50,
    });
    const outsiderActivity = await caller(outsider).listActivity({
      userId: normalUser.id,
      filter: "content",
      limit: 50,
    });

    expect(ownActivity.items.some((item) => item.target?.label === artifact.title)).toBe(true);
    expect(outsiderActivity.items.some((item) => item.target?.label === artifact.title)).toBe(false);
  });
});
