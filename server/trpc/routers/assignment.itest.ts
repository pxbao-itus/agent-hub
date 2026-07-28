import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createTestDb } from "@/server/test-support/test-db";
import * as schema from "@/server/db/schema";
import { createArtifact } from "@/server/services/artifact";
import { assignmentRouter } from "./assignment";
import type { Context } from "@/server/trpc/context";

const { db, close } = createTestDb();

type Identity = { userId: string; systemRole: "user" | "superadmin" };

function callerAs(identity: Identity) {
  const ctx: Context = { db, session: identity };
  return assignmentRouter.createCaller(ctx);
}

async function mustUser(email: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!u) throw new Error(`fixture user not found: ${email}`);
  return u;
}

let engMember: typeof schema.users.$inferSelect;
let marketingMember: typeof schema.users.$inferSelect;
let outsider: typeof schema.users.$inferSelect;
let orgAdmin: typeof schema.users.$inferSelect;
let superadmin: typeof schema.users.$inferSelect;

const createdArtifactIds: string[] = [];

beforeAll(async () => {
  engMember = await mustUser("eng-member@test.local");
  marketingMember = await mustUser("marketing-member@test.local");
  outsider = await mustUser("outsider@test.local");
  orgAdmin = await mustUser("org-admin@test.local");
  superadmin = await mustUser("superadmin@test.local");
});

afterAll(async () => {
  if (createdArtifactIds.length > 0) {
    await db.delete(schema.auditEvents).where(inArray(schema.auditEvents.targetId, createdArtifactIds));
    await db.delete(schema.artifacts).where(inArray(schema.artifacts.id, createdArtifactIds));
  }
  await close();
});

/** Personal-owned throwaway doc, viewer-shared with marketingMember (can view, cannot edit). */
async function makeDoc() {
  const created = await createArtifact(
    {
      kind: "doc",
      ownerType: "user",
      ownerId: engMember.id,
      title: `Assignment router test doc ${Math.random().toString(36).slice(2)}`,
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

async function makeSkill() {
  const created = await createArtifact(
    { kind: "skill", ownerType: "user", ownerId: engMember.id, title: `Assignment router test skill ${Math.random().toString(36).slice(2)}`, body: "v1", createdBy: engMember.id },
    db,
  );
  createdArtifactIds.push(created.id);
  return created;
}

describe("assignment.get", () => {
  it("resolves the default assigner (owner) and lists assignees for someone with read access", async () => {
    const doc = await makeDoc();
    const result = await callerAs({ userId: marketingMember.id, systemRole: "user" }).get({ artifactId: doc.id });
    expect(result.assigner?.id).toBe(engMember.id);
    expect(result.assignees).toEqual([]);
  });

  it("throws FORBIDDEN for someone without read access", async () => {
    const doc = await makeDoc();
    await expect(
      callerAs({ userId: outsider.id, systemRole: "user" }).get({ artifactId: doc.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws BAD_REQUEST for a kind other than doc/plan", async () => {
    const skill = await makeSkill();
    await expect(
      callerAs({ userId: engMember.id, systemRole: "user" }).get({ artifactId: skill.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws NOT_FOUND for an unknown artifact id", async () => {
    await expect(
      callerAs({ userId: engMember.id, systemRole: "user" }).get({ artifactId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("assignment.searchCandidates", () => {
  it("only returns users who can already view the artifact — never someone the mutation would reject", async () => {
    const doc = await makeDoc();
    // All seeded users' names start with "QA ", so this matches everyone —
    // the interesting assertion is which ones survive the access filter.
    const result = await callerAs({ userId: engMember.id, systemRole: "user" }).searchCandidates({
      artifactId: doc.id,
      query: "QA",
    });
    const ids = result.map((u) => u.id);

    expect(ids).toContain(engMember.id); // owner
    expect(ids).toContain(marketingMember.id); // explicit viewer share
    expect(ids).toContain(superadmin.id); // superadmin bypass
    expect(ids).not.toContain(outsider.id); // no share, no cone
    expect(ids).not.toContain(orgAdmin.id); // personal-owned doc — org membership grants nothing here
  });

  it("throws FORBIDDEN for a caller without read access to the artifact", async () => {
    const doc = await makeDoc();
    await expect(
      callerAs({ userId: outsider.id, systemRole: "user" }).searchCandidates({ artifactId: doc.id, query: "QA" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("assignment.setAssigner / addAssignee / removeAssignee — permission gate", () => {
  it("allows the owner (canMutate) to set the assigner and add/remove assignees", async () => {
    const doc = await makeDoc();
    const owner = callerAs({ userId: engMember.id, systemRole: "user" });

    const setResult = await owner.setAssigner({ artifactId: doc.id, userId: marketingMember.id });
    expect(setResult).toMatchObject({ ok: true, changed: true });

    const addResult = await owner.addAssignee({ artifactId: doc.id, userId: marketingMember.id });
    expect(addResult).toMatchObject({ ok: true, alreadyAssigned: false });

    const got = await owner.get({ artifactId: doc.id });
    expect(got.assigner?.id).toBe(marketingMember.id);
    expect(got.assignees.map((u) => u.id)).toEqual([marketingMember.id]);

    const removeResult = await owner.removeAssignee({ artifactId: doc.id, userId: marketingMember.id });
    expect(removeResult).toMatchObject({ ok: true, removed: true });
  });

  it("denies a viewer-share (can read, cannot edit) on all three mutations", async () => {
    const doc = await makeDoc();
    const viewer = callerAs({ userId: marketingMember.id, systemRole: "user" });

    await expect(viewer.setAssigner({ artifactId: doc.id, userId: marketingMember.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.addAssignee({ artifactId: doc.id, userId: marketingMember.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.removeAssignee({ artifactId: doc.id, userId: marketingMember.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("surfaces the service's target-access failure as BAD_REQUEST", async () => {
    const doc = await makeDoc();
    const owner = callerAs({ userId: engMember.id, systemRole: "user" });
    await expect(
      owner.setAssigner({ artifactId: doc.id, userId: outsider.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("assignment.history", () => {
  it("lists assignment-only audit events, newest first, readable by a viewer-share", async () => {
    const doc = await makeDoc();
    const owner = callerAs({ userId: engMember.id, systemRole: "user" });
    await owner.setAssigner({ artifactId: doc.id, userId: marketingMember.id });
    await owner.addAssignee({ artifactId: doc.id, userId: marketingMember.id });

    const history = await callerAs({ userId: marketingMember.id, systemRole: "user" }).history({ artifactId: doc.id });
    expect(history.map((h) => h.action)).toEqual(["assignment.assignee.add", "assignment.assigner.change"]);
  });

  it("throws FORBIDDEN for someone without read access", async () => {
    const doc = await makeDoc();
    await expect(
      callerAs({ userId: outsider.id, systemRole: "user" }).history({ artifactId: doc.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
