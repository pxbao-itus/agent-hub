import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createTestDb } from "@/server/test-support/test-db";
import * as schema from "@/server/db/schema";
import { createArtifact } from "@/server/services/artifact";
import { shareRouter } from "./share";
import { promptRouter } from "./prompt";
import { tokenRouter } from "./token";
import { auditRouter } from "./audit";
import type { Context } from "@/server/trpc/context";

const { db, close } = createTestDb();

type Identity = { userId: string; systemRole: "user" | "superadmin" };
const ctxFor = (id: Identity): Context => ({ db, session: id });

async function mustUser(email: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!u) throw new Error(`fixture user not found: ${email}`);
  return u;
}

let engMember: typeof schema.users.$inferSelect;
let marketingMember: typeof schema.users.$inferSelect;
let superadmin: typeof schema.users.$inferSelect;

const createdArtifactIds: string[] = [];

beforeAll(async () => {
  engMember = await mustUser("eng-member@test.local");
  marketingMember = await mustUser("marketing-member@test.local");
  superadmin = await mustUser("superadmin@test.local");
});

// Clear BEFORE each test, not just after: other integration files (e.g.
// project.itest's member add/remove) also write audit_events and don't clean
// them, so starting from empty is what makes this file's exact-count
// assertions order-independent.
beforeEach(async () => {
  await db.delete(schema.auditEvents);
});

afterAll(async () => {
  if (createdArtifactIds.length > 0) {
    await db.delete(schema.artifacts).where(inArray(schema.artifacts.id, createdArtifactIds));
  }
  await db.delete(schema.auditEvents);
  await close();
});

describe("recordAudit wiring via real mutations", () => {
  it("logs artifact.delete when a prompt is deleted", async () => {
    const p = await createArtifact(
      { kind: "prompt", ownerType: "user", ownerId: engMember.id, title: "audit-del prompt", body: "x", createdBy: engMember.id },
      db,
    );
    await promptRouter.createCaller(ctxFor({ userId: engMember.id, systemRole: "user" })).delete({ id: p.id });

    const events = await db.select().from(schema.auditEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: engMember.id, action: "artifact.delete", targetType: "artifact", targetId: p.id });
    expect(events[0].metadata).toMatchObject({ kind: "prompt", title: "audit-del prompt" });
  });

  it("logs share.grant then share.revoke", async () => {
    const p = await createArtifact(
      { kind: "prompt", ownerType: "user", ownerId: engMember.id, title: "audit-share prompt", body: "x", createdBy: engMember.id },
      db,
    );
    createdArtifactIds.push(p.id);
    const caller = shareRouter.createCaller(ctxFor({ userId: engMember.id, systemRole: "user" }));

    await caller.add({ artifactId: p.id, userId: marketingMember.id, role: "viewer" });
    await caller.remove({ artifactId: p.id, userId: marketingMember.id });

    const events = await db.select().from(schema.auditEvents).orderBy(schema.auditEvents.createdAt);
    const actions = events.map((e) => e.action);
    expect(actions).toContain("share.grant");
    expect(actions).toContain("share.revoke");
    const grant = events.find((e) => e.action === "share.grant")!;
    expect(grant.metadata).toMatchObject({ granteeUserId: marketingMember.id, role: "viewer" });
  });

  it("logs token.create and token.revoke", async () => {
    const caller = tokenRouter.createCaller(ctxFor({ userId: engMember.id, systemRole: "user" }));
    const token = await caller.create({ name: "audit-test-token" });
    await caller.revoke({ id: token.id });

    const events = await db.select().from(schema.auditEvents);
    const actions = events.map((e) => e.action).sort();
    expect(actions).toEqual(["token.create", "token.revoke"]);
    expect(events.every((e) => e.actorId === engMember.id && e.targetType === "token")).toBe(true);
  });
});

describe("audit.list — read authorization", () => {
  it("lets a superadmin read events, newest first", async () => {
    const p = await createArtifact(
      { kind: "prompt", ownerType: "user", ownerId: engMember.id, title: "audit-list prompt", body: "x", createdBy: engMember.id },
      db,
    );
    await promptRouter.createCaller(ctxFor({ userId: engMember.id, systemRole: "user" })).delete({ id: p.id });

    const rows = await auditRouter.createCaller(ctxFor({ userId: superadmin.id, systemRole: "superadmin" })).list({ limit: 50 });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].action).toBe("artifact.delete");
    expect(rows[0].actorEmail).toBe("eng-member@test.local");
  });

  it("rejects a non-superadmin caller", async () => {
    await expect(
      auditRouter.createCaller(ctxFor({ userId: engMember.id, systemRole: "user" })).list({ limit: 50 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
