import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, and } from "drizzle-orm";
import { createTestDb } from "@/server/test-support/test-db";
import * as schema from "@/server/db/schema";
import { createArtifact } from "@/server/services/artifact";
import {
  addAssignee,
  getAssignments,
  getWorkItem,
  removeAssignee,
  resolveAssigner,
  setAssigner,
  updateWorkItem,
} from "./assignment";

/**
 * This file creates real, permanent throwaway artifacts (+ shares) to
 * exercise assignment without mutating seeded fixtures other suites depend
 * on — same isolation lesson as notification.itest.ts / server.itest.ts
 * (Phase 52's ambiguous-slug test paid for skipping this).
 */

const { db, close } = createTestDb();

let engMember: typeof schema.users.$inferSelect;
let marketingMember: typeof schema.users.$inferSelect;
let outsider: typeof schema.users.$inferSelect;
let backend: typeof schema.teams.$inferSelect;

const createdArtifactIds: string[] = [];

async function mustUser(email: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!u) throw new Error(`fixture user not found: ${email}`);
  return u;
}

beforeAll(async () => {
  engMember = await mustUser("eng-member@test.local");
  marketingMember = await mustUser("marketing-member@test.local");
  outsider = await mustUser("outsider@test.local");
  [backend] = await db.select().from(schema.teams).where(eq(schema.teams.slug, "backend"));
});

afterAll(async () => {
  if (createdArtifactIds.length > 0) {
    // audit_events.targetId is polymorphic (no FK, see schema.ts) so deleting
    // the artifacts does NOT cascade-clean the audit rows this file wrote —
    // clear them explicitly (same discipline as audit.itest.ts/workflow.itest.ts).
    await db.delete(schema.auditEvents).where(inArray(schema.auditEvents.targetId, createdArtifactIds));
    await db.delete(schema.artifacts).where(inArray(schema.artifacts.id, createdArtifactIds));
  }
  await close();
});

/** Personal-owned throwaway doc/plan, shared (viewer) with marketingMember so they're a valid assign target. */
async function makeDoc(opts: { createdBy: string; shareWith?: string[] }) {
  const created = await createArtifact(
    {
      kind: "doc",
      ownerType: "user",
      ownerId: opts.createdBy,
      title: `Assignment test doc ${Math.random().toString(36).slice(2)}`,
      body: "v1 body",
      createdBy: opts.createdBy,
    },
    db,
  );
  createdArtifactIds.push(created.id);
  for (const userId of opts.shareWith ?? []) {
    await db.insert(schema.artifactShares).values({ artifactId: created.id, userId, role: "viewer", grantedBy: opts.createdBy });
  }
  return created;
}

async function makeSkill(createdBy: string) {
  const created = await createArtifact(
    { kind: "skill", ownerType: "user", ownerId: createdBy, title: `Assignment test skill ${Math.random().toString(36).slice(2)}`, body: "v1", createdBy },
    db,
  );
  createdArtifactIds.push(created.id);
  return created;
}

async function auditFor(artifactId: string) {
  return db
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.targetId, artifactId));
}

async function notificationsFor(artifactId: string) {
  return db.query.notifications.findMany({ where: eq(schema.notifications.artifactId, artifactId) });
}

describe("resolveAssigner / getAssignments — default resolution", () => {
  it("defaults to the owner-user when the artifact is personally owned", async () => {
    const doc = await makeDoc({ createdBy: engMember.id });
    expect(await resolveAssigner(doc, db)).toBe(engMember.id);
    expect(await getAssignments(doc, db)).toEqual({ assignerId: engMember.id, assigneeIds: [] });
  });

  it("defaults to createdBy when the artifact is group-owned", async () => {
    const created = await createArtifact(
      {
        kind: "plan",
        ownerType: "team",
        ownerId: backend.id,
        title: `Assignment test group plan ${Math.random().toString(36).slice(2)}`,
        body: "v1",
        visibility: "group",
        createdBy: marketingMember.id,
      },
      db,
    );
    createdArtifactIds.push(created.id);
    expect(await resolveAssigner(created, db)).toBe(marketingMember.id);
  });
});

describe("setAssigner", () => {
  it("overrides the default assigner, audits old->new, and notifies only the non-actor party", async () => {
    const doc = await makeDoc({ createdBy: engMember.id, shareWith: [marketingMember.id] });

    const result = await setAssigner(doc, marketingMember.id, engMember.id, db);
    expect(result).toEqual({ ok: true, oldAssignerId: engMember.id, changed: true });
    expect(await resolveAssigner(doc, db)).toBe(marketingMember.id);

    const audit = await auditFor(doc.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("assignment.assigner.change");
    expect(audit[0].actorId).toBe(engMember.id);
    expect(audit[0].metadata).toEqual({
      oldAssignerId: engMember.id,
      oldAssignerName: engMember.name ?? engMember.email,
      newAssignerId: marketingMember.id,
      newAssignerName: marketingMember.name ?? marketingMember.email,
    });

    // Recipients are [new, old] minus the actor — engMember is both old assigner
    // and actor here, so only marketingMember (the new assigner) gets notified.
    const notifs = await notificationsFor(doc.id);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].userId).toBe(marketingMember.id);
    expect(notifs[0].type).toBe("assignment");
    expect(notifs[0].actorId).toBe(engMember.id);
    expect((notifs[0].metadata as Record<string, unknown>).event).toBe("assigner.change");
    expect(
      await db.query.artifactSubscriptions.findFirst({
        where: and(
          eq(schema.artifactSubscriptions.artifactId, doc.id),
          eq(schema.artifactSubscriptions.userId, marketingMember.id),
        ),
      }),
    ).toMatchObject({ mode: "all" });
  });

  it("is idempotent: re-setting the same assigner reports changed:false and writes no new audit/notification row", async () => {
    const doc = await makeDoc({ createdBy: engMember.id, shareWith: [marketingMember.id] });
    await setAssigner(doc, marketingMember.id, engMember.id, db);

    const result = await setAssigner(doc, marketingMember.id, marketingMember.id, db);
    expect(result).toEqual({ ok: true, oldAssignerId: marketingMember.id, changed: false });

    expect(await auditFor(doc.id)).toHaveLength(1);
    expect(await notificationsFor(doc.id)).toHaveLength(1);
  });

  it("rejects a kind other than doc/plan", async () => {
    const skill = await makeSkill(engMember.id);
    const result = await setAssigner(skill, marketingMember.id, engMember.id, db);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("Only docs and plans") });
  });

  it("rejects a target user who cannot view the artifact yet", async () => {
    const doc = await makeDoc({ createdBy: engMember.id });
    const result = await setAssigner(doc, outsider.id, engMember.id, db);
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain("doesn't have access");
  });

  it("the DB enforces at most one assigner row per artifact (defense in depth, independent of the service)", async () => {
    const doc = await makeDoc({ createdBy: engMember.id, shareWith: [marketingMember.id] });
    await db.insert(schema.artifactAssignments).values({ artifactId: doc.id, userId: engMember.id, role: "assigner", assignedBy: engMember.id });

    await expect(
      db.insert(schema.artifactAssignments).values({ artifactId: doc.id, userId: marketingMember.id, role: "assigner", assignedBy: engMember.id }),
    ).rejects.toThrow();
  });
});

describe("addAssignee / removeAssignee", () => {
  it("adds an assignee, audits, and notifies the assignee + the effective assigner (not the actor)", async () => {
    const doc = await makeDoc({ createdBy: engMember.id, shareWith: [marketingMember.id] });

    const result = await addAssignee(doc, marketingMember.id, engMember.id, db);
    expect(result).toEqual({ ok: true, alreadyAssigned: false });
    expect((await getAssignments(doc, db)).assigneeIds).toEqual([marketingMember.id]);

    const audit = await auditFor(doc.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("assignment.assignee.add");

    // engMember is both the effective (owner) assigner and the actor here, so
    // only marketingMember (the new assignee) should be notified.
    const notifs = await notificationsFor(doc.id);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].userId).toBe(marketingMember.id);
    expect((notifs[0].metadata as Record<string, unknown>).event).toBe("assignee.add");
    expect(
      await db.query.artifactSubscriptions.findFirst({
        where: and(
          eq(schema.artifactSubscriptions.artifactId, doc.id),
          eq(schema.artifactSubscriptions.userId, marketingMember.id),
        ),
      }),
    ).toMatchObject({ mode: "all" });
  });

  it("adding the same assignee twice is a no-op (alreadyAssigned:true, no new audit/notification)", async () => {
    const doc = await makeDoc({ createdBy: engMember.id, shareWith: [marketingMember.id] });
    await addAssignee(doc, marketingMember.id, engMember.id, db);

    const result = await addAssignee(doc, marketingMember.id, engMember.id, db);
    expect(result).toEqual({ ok: true, alreadyAssigned: true });
    expect(await auditFor(doc.id)).toHaveLength(1);
    expect(await notificationsFor(doc.id)).toHaveLength(1);
  });

  it("rejects a target user who cannot view the artifact yet", async () => {
    const doc = await makeDoc({ createdBy: engMember.id });
    const result = await addAssignee(doc, outsider.id, engMember.id, db);
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain("doesn't have access");
  });

  it("rejects a kind other than doc/plan", async () => {
    const skill = await makeSkill(engMember.id);
    const result = await addAssignee(skill, marketingMember.id, engMember.id, db);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("Only docs and plans") });
  });

  it("removes an assignee, audits, and notifies the removed assignee + the effective assigner", async () => {
    const doc = await makeDoc({ createdBy: engMember.id, shareWith: [marketingMember.id] });
    await addAssignee(doc, marketingMember.id, engMember.id, db);

    const result = await removeAssignee(doc, marketingMember.id, engMember.id, db);
    expect(result).toEqual({ ok: true, removed: true });
    expect((await getAssignments(doc, db)).assigneeIds).toEqual([]);

    const audit = (await auditFor(doc.id)).filter((a) => a.action === "assignment.assignee.remove");
    expect(audit).toHaveLength(1);

    const notifs = (await notificationsFor(doc.id)).filter(
      (n) => (n.metadata as Record<string, unknown> | null)?.event === "assignee.remove",
    );
    expect(notifs).toHaveLength(1);
    expect(notifs[0].userId).toBe(marketingMember.id);
  });

  it("removing a non-assignee is a no-op (removed:false, no new audit/notification)", async () => {
    const doc = await makeDoc({ createdBy: engMember.id, shareWith: [marketingMember.id] });
    const result = await removeAssignee(doc, marketingMember.id, engMember.id, db);
    expect(result).toEqual({ ok: true, removed: false });
    expect(await auditFor(doc.id)).toHaveLength(0);
    expect(await notificationsFor(doc.id)).toHaveLength(0);
  });

  it("rejects a kind other than doc/plan", async () => {
    const skill = await makeSkill(engMember.id);
    const result = await removeAssignee(skill, marketingMember.id, engMember.id, db);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("Only docs and plans") });
  });

  it("removal does not re-check view access — revoking the share first still lets removal succeed", async () => {
    const doc = await makeDoc({ createdBy: engMember.id, shareWith: [marketingMember.id] });
    await addAssignee(doc, marketingMember.id, engMember.id, db);
    await db
      .delete(schema.artifactShares)
      .where(and(eq(schema.artifactShares.artifactId, doc.id), eq(schema.artifactShares.userId, marketingMember.id)));

    const result = await removeAssignee(doc, marketingMember.id, engMember.id, db);
    expect(result).toEqual({ ok: true, removed: true });
  });
});

describe("work-item fields", () => {
  it("reads defaults without materializing a row, then lazily upserts manager changes", async () => {
    const doc = await makeDoc({ createdBy: engMember.id, shareWith: [marketingMember.id] });
    expect(await getWorkItem(doc.id, db)).toEqual({ status: "open", priority: "normal", dueDate: null });
    expect(await db.select().from(schema.artifactWorkItems).where(eq(schema.artifactWorkItems.artifactId, doc.id))).toHaveLength(0);

    const result = await updateWorkItem(
      doc,
      { status: "in_progress", priority: "high", dueDate: "2026-08-15" },
      { userId: engMember.id, systemRole: "user" },
      db,
    );
    expect(result).toMatchObject({
      ok: true,
      changedFields: ["status", "priority", "dueDate"],
      after: { status: "in_progress", priority: "high", dueDate: "2026-08-15" },
    });
    expect(await getWorkItem(doc.id, db)).toEqual({
      status: "in_progress",
      priority: "high",
      dueDate: "2026-08-15",
    });
  });

  it("lets an assignee viewer update status but not priority or due date", async () => {
    const doc = await makeDoc({ createdBy: engMember.id, shareWith: [marketingMember.id] });
    await addAssignee(doc, marketingMember.id, engMember.id, db);

    const status = await updateWorkItem(
      doc,
      { status: "blocked" },
      { userId: marketingMember.id, systemRole: "user" },
      db,
    );
    expect(status).toMatchObject({ ok: true, after: { status: "blocked" } });

    const priority = await updateWorkItem(
      doc,
      { priority: "urgent" },
      { userId: marketingMember.id, systemRole: "user" },
      db,
    );
    expect(priority).toEqual({
      ok: false,
      message: "Only an artifact manager can update priority or due date.",
    });
  });

  it("does not audit or notify a no-op and rejects invalid dates", async () => {
    const doc = await makeDoc({ createdBy: engMember.id });
    const noop = await updateWorkItem(
      doc,
      { status: "open" },
      { userId: engMember.id, systemRole: "user" },
      db,
    );
    expect(noop).toMatchObject({ ok: true, changedFields: [] });
    expect(await auditFor(doc.id)).toHaveLength(0);
    expect(await notificationsFor(doc.id)).toHaveLength(0);

    const invalid = await updateWorkItem(
      doc,
      { dueDate: "2026-02-31" },
      { userId: engMember.id, systemRole: "user" },
      db,
    );
    expect(invalid).toEqual({
      ok: false,
      message: "Due date must be a valid date in YYYY-MM-DD format.",
    });
  });
});
