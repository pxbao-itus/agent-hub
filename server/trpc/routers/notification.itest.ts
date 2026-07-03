import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, and } from "drizzle-orm";
import { createTestDb } from "@/server/test-support/test-db";
import * as schema from "@/server/db/schema";
import { createArtifact } from "@/server/services/artifact";
import { rollbackVersion } from "@/server/services/version";
import { promptRouter } from "./prompt";
import { skillRouter } from "./skill";
import { kitRouter } from "./kit";
import { docRouter } from "./doc";
import { planRouter } from "./plan";
import { notificationRouter } from "./notification";
import type { Context } from "@/server/trpc/context";

const { db, close } = createTestDb();

type Identity = { userId: string; systemRole: "user" | "superadmin" };

function callerFor<T extends { createCaller: (ctx: Context) => unknown }>(router: T, identity: Identity) {
  const ctx: Context = { db, session: identity };
  return router.createCaller(ctx) as ReturnType<T["createCaller"]>;
}

async function mustUser(email: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!u) throw new Error(`fixture user not found: ${email}`);
  return u;
}

let engMember: typeof schema.users.$inferSelect;
let marketingMember: typeof schema.users.$inferSelect;

// This file creates real, permanent artifacts + shares to exercise the
// notify trigger without mutating seeded fixtures other suites depend on
// (same isolation lesson as artifact.itest.ts / server.itest.ts).
const createdArtifactIds: string[] = [];

beforeAll(async () => {
  engMember = await mustUser("eng-member@test.local");
  marketingMember = await mustUser("marketing-member@test.local");
});

afterAll(async () => {
  if (createdArtifactIds.length > 0) {
    await db.delete(schema.artifacts).where(inArray(schema.artifacts.id, createdArtifactIds));
  }
  await close();
});

async function makeSharedArtifact(kind: "prompt" | "skill" | "kit" | "plan" | "doc") {
  const created = await createArtifact(
    {
      kind,
      ownerType: "user",
      ownerId: engMember.id,
      title: `Notify test ${kind} ${Math.random().toString(36).slice(2)}`,
      body: "v1 body",
      createdBy: engMember.id,
    },
    db,
  );
  createdArtifactIds.push(created.id);
  await db.insert(schema.artifactShares).values({
    artifactId: created.id,
    userId: marketingMember.id,
    role: "viewer",
    grantedBy: engMember.id,
  });
  return created;
}

async function notificationsFor(artifactId: string) {
  return db.query.notifications.findMany({ where: eq(schema.notifications.artifactId, artifactId) });
}

describe("notifyVersionChange trigger — wired into all 5 kind routers", () => {
  it("prompt.update notifies the share recipient, not the actor", async () => {
    const artifact = await makeSharedArtifact("prompt");
    const caller = callerFor(promptRouter, { userId: engMember.id, systemRole: "user" });
    await caller.update({ id: artifact.id, body: "v2 body" });

    const rows = await notificationsFor(artifact.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(marketingMember.id);
    expect(rows[0].actorId).toBe(engMember.id);
    expect(rows[0].isRead).toBe(false);
  });

  it("skill.update notifies the share recipient", async () => {
    const artifact = await makeSharedArtifact("skill");
    const caller = callerFor(skillRouter, { userId: engMember.id, systemRole: "user" });
    await caller.update({ id: artifact.id, body: "v2 body" });

    const rows = await notificationsFor(artifact.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(marketingMember.id);
  });

  it("kit.update notifies the share recipient", async () => {
    const artifact = await makeSharedArtifact("kit");
    const caller = callerFor(kitRouter, { userId: engMember.id, systemRole: "user" });
    await caller.update({ id: artifact.id, body: "v2 body" });

    const rows = await notificationsFor(artifact.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(marketingMember.id);
  });

  it("doc.update notifies the share recipient", async () => {
    const artifact = await makeSharedArtifact("doc");
    const caller = callerFor(docRouter, { userId: engMember.id, systemRole: "user" });
    await caller.update({ id: artifact.id, body: "v2 body" });

    const rows = await notificationsFor(artifact.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(marketingMember.id);
  });

  it("plan.update notifies the share recipient", async () => {
    const artifact = await makeSharedArtifact("plan");
    const caller = callerFor(planRouter, { userId: engMember.id, systemRole: "user" });
    await caller.update({ id: artifact.id, body: "v2 body" });

    const rows = await notificationsFor(artifact.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(marketingMember.id);
  });

  it("rollbackVersion also notifies the share recipient", async () => {
    const artifact = await makeSharedArtifact("prompt");
    const caller = callerFor(promptRouter, { userId: engMember.id, systemRole: "user" });
    await caller.update({ id: artifact.id, body: "v2 body" }); // -> 1 notification already

    await rollbackVersion(artifact.id, 1, engMember.id, db);

    const rows = await notificationsFor(artifact.id);
    expect(rows).toHaveLength(2);
  });

  it("editing an unshared artifact creates no notification", async () => {
    const created = await createArtifact(
      { kind: "prompt", ownerType: "user", ownerId: engMember.id, title: "Notify test unshared", body: "v1", createdBy: engMember.id },
      db,
    );
    createdArtifactIds.push(created.id);

    const caller = callerFor(promptRouter, { userId: engMember.id, systemRole: "user" });
    await caller.update({ id: created.id, body: "v2 body" });

    const rows = await notificationsFor(created.id);
    expect(rows).toHaveLength(0);
  });

  it("editing metadata only (no body) creates no version and no notification", async () => {
    const artifact = await makeSharedArtifact("prompt");
    const caller = callerFor(promptRouter, { userId: engMember.id, systemRole: "user" });
    await caller.update({ id: artifact.id, description: "updated description only" });

    const rows = await notificationsFor(artifact.id);
    expect(rows).toHaveLength(0);
  });
});

describe("notification router", () => {
  it("list/unreadCount/markAsRead/markAllAsRead round-trip", async () => {
    const a = await makeSharedArtifact("doc");
    const b = await makeSharedArtifact("doc");

    const actor = callerFor(promptRouter, { userId: engMember.id, systemRole: "user" });
    await callerFor(docRouter, { userId: engMember.id, systemRole: "user" }).update({ id: a.id, body: "v2" });
    await callerFor(docRouter, { userId: engMember.id, systemRole: "user" }).update({ id: b.id, body: "v2" });
    void actor; // silence unused-var if tree-shaken differently across kinds

    const recipient = callerFor(notificationRouter, { userId: marketingMember.id, systemRole: "user" });

    const before = await recipient.unreadCount();
    expect(before.count).toBeGreaterThanOrEqual(2);

    const list = await recipient.list({ limit: 50 });
    const mine = list.filter((n) => n.artifactId === a.id || n.artifactId === b.id);
    expect(mine).toHaveLength(2);

    const target = mine.find((n) => n.artifactId === a.id)!;
    await recipient.markAsRead({ id: target.id });
    const afterOne = await recipient.list({ limit: 50 });
    expect(afterOne.find((n) => n.id === target.id)?.isRead).toBe(true);

    await recipient.markAllAsRead();
    const afterAllRead = await recipient.unreadCount();
    expect(afterAllRead.count).toBe(0);
  });

  it("markAsRead is a no-op (returns null) for another user's notification", async () => {
    const artifact = await makeSharedArtifact("prompt");
    await callerFor(promptRouter, { userId: engMember.id, systemRole: "user" }).update({ id: artifact.id, body: "v2" });

    const [row] = await notificationsFor(artifact.id);
    const wrongUser = callerFor(notificationRouter, { userId: engMember.id, systemRole: "user" });
    const result = await wrongUser.markAsRead({ id: row.id });
    expect(result).toBeNull();

    const [stillUnread] = await db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.id, row.id), eq(schema.notifications.isRead, false)));
    expect(stillUnread).toBeDefined();
  });
});
