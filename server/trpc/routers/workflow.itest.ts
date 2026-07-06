import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createTestDb } from "@/server/test-support/test-db";
import * as schema from "@/server/db/schema";
import { workflowRouter } from "./workflow";
import type { Context } from "@/server/trpc/context";

const { db, close } = createTestDb();

type Identity = { userId: string; systemRole: "user" | "superadmin" };

function callerAs(identity: Identity) {
  const ctx: Context = { db, session: identity };
  return workflowRouter.createCaller(ctx);
}

async function mustUser(email: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!u) throw new Error(`fixture user not found: ${email}`);
  return u;
}

async function mustArtifact(title: string) {
  const [a] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.title, title));
  if (!a) throw new Error(`fixture artifact not found: ${title}`);
  return a;
}

async function mustWorkflow(name: string) {
  const [w] = await db.select().from(schema.workflows).where(eq(schema.workflows.name, name));
  if (!w) throw new Error(`fixture workflow not found: ${name}`);
  return w;
}

async function mustProject(name: string) {
  const [p] = await db.select().from(schema.projects).where(eq(schema.projects.name, name));
  if (!p) throw new Error(`fixture project not found: ${name}`);
  return p;
}

let superadmin: typeof schema.users.$inferSelect;
let orgAdmin: typeof schema.users.$inferSelect;
let orgViewer: typeof schema.users.$inferSelect;
let engMember: typeof schema.users.$inferSelect;
let marketingMember: typeof schema.users.$inferSelect;
let outsider: typeof schema.users.$inferSelect;
let org: typeof schema.orgs.$inferSelect;
let backend: typeof schema.teams.$inferSelect;
let content: typeof schema.teams.$inferSelect;

// Every workflow created inside these tests is tracked and deleted in
// afterAll — the seeded "Session bug fix process" workflow is left untouched
// (other test files may assume it still exists, and its audit_events row
// from this file's own delete test must not linger for audit.itest.ts).
const createdWorkflowIds: string[] = [];

beforeAll(async () => {
  superadmin = await mustUser("superadmin@test.local");
  orgAdmin = await mustUser("org-admin@test.local");
  orgViewer = await mustUser("org-viewer@test.local");
  engMember = await mustUser("eng-member@test.local");
  marketingMember = await mustUser("marketing-member@test.local");
  outsider = await mustUser("outsider@test.local");
  [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, "qa-org"));
  [backend] = await db.select().from(schema.teams).where(eq(schema.teams.slug, "backend"));
  [content] = await db.select().from(schema.teams).where(eq(schema.teams.slug, "content"));
});

afterAll(async () => {
  if (createdWorkflowIds.length > 0) {
    await db.delete(schema.workflows).where(inArray(schema.workflows.id, createdWorkflowIds));
  }
  await db.delete(schema.auditEvents);
  await close();
});

describe("workflow.create", () => {
  it("allows a team editor to create a workflow with initial stages", async () => {
    const workflow = await callerAs({ userId: engMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      name: "New process",
      stages: ["Spec", "Build"],
    });
    createdWorkflowIds.push(workflow.id);

    const stages = await db.select().from(schema.workflowStages).where(eq(schema.workflowStages.workflowId, workflow.id));
    expect(stages.map((s) => s.name).sort()).toEqual(["Build", "Spec"]);
  });

  it("allows an org admin to create for a descendant team (D-016 downward mutate)", async () => {
    const workflow = await callerAs({ userId: orgAdmin.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: content.id,
      name: "Content team process",
      stages: [],
    });
    createdWorkflowIds.push(workflow.id);
    expect(workflow.ownerGroupId).toBe(content.id);
  });

  it("rejects a user with no role in the owning group's chain", async () => {
    await expect(
      callerAs({ userId: marketingMember.id, systemRole: "user" }).create({
        ownerGroupType: "team",
        ownerGroupId: backend.id,
        name: "Should not be created",
        stages: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a non-existent projectId", async () => {
    await expect(
      callerAs({ userId: engMember.id, systemRole: "user" }).create({
        ownerGroupType: "team",
        ownerGroupId: backend.id,
        name: "Bad link",
        projectId: "00000000-0000-0000-0000-000000000000",
        stages: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("accepts a valid projectId link", async () => {
    const project1 = await mustProject("Session bug fix");
    const workflow = await callerAs({ userId: engMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      name: "Linked to project",
      projectId: project1.id,
      stages: [],
    });
    createdWorkflowIds.push(workflow.id);
    expect(workflow.projectId).toBe(project1.id);
  });
});

describe("workflow.list / listForProject — cone visibility (D-016)", () => {
  it("an outsider with no membership anywhere sees no workflows", async () => {
    const list = await callerAs({ userId: outsider.id, systemRole: "user" }).list();
    expect(list).toEqual([]);
  });

  it("a different team's member does not see a workflow owned by another team", async () => {
    const list = await callerAs({ userId: marketingMember.id, systemRole: "user" }).list();
    expect(list.find((w) => w.name === "Session bug fix process")).toBeUndefined();
  });

  it("an org-level viewer sees a descendant team's workflow, with canManage=false", async () => {
    const list = await callerAs({ userId: orgViewer.id, systemRole: "user" }).list();
    const found = list.find((w) => w.name === "Session bug fix process");
    expect(found).toBeDefined();
    expect(found!.canManage).toBe(false);
  });

  it("the owning team's editor sees it with correct progress and canManage=true", async () => {
    const list = await callerAs({ userId: engMember.id, systemRole: "user" }).list();
    const found = list.find((w) => w.name === "Session bug fix process");
    expect(found).toBeDefined();
    expect(found!.canManage).toBe(true);
    expect(found!.stageCount).toBe(3);
    expect(found!.doneCount).toBe(1); // Spec is done; Build doing; Review todo
  });

  it("listForProject returns the workflow linked to the seeded project", async () => {
    const project1 = await mustProject("Session bug fix");
    const list = await callerAs({ userId: engMember.id, systemRole: "user" }).listForProject({ projectId: project1.id });
    expect(list.find((w) => w.name === "Session bug fix process")).toBeDefined();
  });

  it("listForProject returns nothing for a caller outside the cone", async () => {
    const project1 = await mustProject("Session bug fix");
    const list = await callerAs({ userId: outsider.id, systemRole: "user" }).listForProject({ projectId: project1.id });
    expect(list).toEqual([]);
  });
});

describe("workflow.get", () => {
  it("throws FORBIDDEN for a caller outside the owning group's cone", async () => {
    const workflow1 = await mustWorkflow("Session bug fix process");
    await expect(
      callerAs({ userId: outsider.id, systemRole: "user" }).get({ id: workflow1.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reports canManage=false for a viewer, true for an editor/admin", async () => {
    const workflow1 = await mustWorkflow("Session bug fix process");

    const asViewer = await callerAs({ userId: orgViewer.id, systemRole: "user" }).get({ id: workflow1.id });
    expect(asViewer.canManage).toBe(false);

    const asEditor = await callerAs({ userId: engMember.id, systemRole: "user" }).get({ id: workflow1.id });
    expect(asEditor.canManage).toBe(true);
  });

  it("returns stages in order with correct status and attached artifacts", async () => {
    const workflow1 = await mustWorkflow("Session bug fix process");
    const result = await callerAs({ userId: engMember.id, systemRole: "user" }).get({ id: workflow1.id });

    expect(result.stages.map((s) => s.name)).toEqual(["Spec", "Build", "Review"]);
    expect(result.stages.map((s) => s.status)).toEqual(["done", "doing", "todo"]);

    const specTitles = result.stages[0].artifacts.map((a) => a.title);
    expect(specTitles).toContain("Lỗi: phiên đăng nhập hết hạn sau 5 phút"); // doc1

    const buildTitles = result.stages[1].artifacts.map((a) => a.title).sort();
    expect(buildTitles).toEqual(
      ["Code review starter kit", "PR review checklist", "Sửa lỗi phiên đăng nhập hết hạn sớm"].sort(),
    );

    expect(result.stages[2].artifacts).toEqual([]);
  });

  it("filters an attached artifact the viewer can't read, while the attacher still sees it", async () => {
    const workflow = await callerAs({ userId: engMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      name: "Private-attachment test",
      stages: ["Only stage"],
    });
    createdWorkflowIds.push(workflow.id);
    const created = await callerAs({ userId: engMember.id, systemRole: "user" }).get({ id: workflow.id });
    const stageId = created.stages[0].id;

    // prompt2 is private to engMember — engMember can attach it (manages the
    // workflow + can read their own private artifact), but orgAdmin (who can
    // view this backend-team workflow via the org cone) cannot read it.
    const prompt2 = await mustArtifact("Summarize meeting notes");
    await callerAs({ userId: engMember.id, systemRole: "user" }).attachArtifact({ stageId, artifactId: prompt2.id });

    const asOwner = await callerAs({ userId: engMember.id, systemRole: "user" }).get({ id: workflow.id });
    expect(asOwner.stages[0].artifacts.map((a) => a.id)).toContain(prompt2.id);

    const asOrgAdmin = await callerAs({ userId: orgAdmin.id, systemRole: "user" }).get({ id: workflow.id });
    expect(asOrgAdmin.stages[0].artifacts.map((a) => a.id)).not.toContain(prompt2.id);
  });
});

describe("workflow.addStage / updateStage / removeStage / reorderStages", () => {
  it("addStage appends at the end, updateStage renames, removeStage removes", async () => {
    const workflow = await callerAs({ userId: engMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      name: "Stage CRUD test",
      stages: ["First"],
    });
    createdWorkflowIds.push(workflow.id);

    const added = await callerAs({ userId: engMember.id, systemRole: "user" }).addStage({ workflowId: workflow.id, name: "Second" });
    expect(added.position).toBe(1);

    const renamed = await callerAs({ userId: engMember.id, systemRole: "user" }).updateStage({ stageId: added.id, name: "Second (renamed)" });
    expect(renamed.name).toBe("Second (renamed)");

    await callerAs({ userId: engMember.id, systemRole: "user" }).removeStage({ stageId: added.id });
    const remaining = await db.select().from(schema.workflowStages).where(eq(schema.workflowStages.workflowId, workflow.id));
    expect(remaining.map((s) => s.name)).toEqual(["First"]);
  });

  it("rejects stage mutations from a non-manager", async () => {
    const workflow1 = await mustWorkflow("Session bug fix process");
    const stages = await db.select().from(schema.workflowStages).where(eq(schema.workflowStages.workflowId, workflow1.id));
    await expect(
      callerAs({ userId: orgViewer.id, systemRole: "user" }).updateStage({ stageId: stages[0].id, name: "Hacked" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reorderStages rejects a set that doesn't exactly match current stages", async () => {
    const workflow = await callerAs({ userId: engMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      name: "Reorder mismatch test",
      stages: ["A", "B"],
    });
    createdWorkflowIds.push(workflow.id);

    await expect(
      callerAs({ userId: engMember.id, systemRole: "user" }).reorderStages({
        workflowId: workflow.id,
        stageIds: ["00000000-0000-0000-0000-000000000000"],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("reorderStages persists the new order", async () => {
    const workflow = await callerAs({ userId: engMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      name: "Reorder roundtrip test",
      stages: ["A", "B"],
    });
    createdWorkflowIds.push(workflow.id);
    const stages = await db.select().from(schema.workflowStages).where(eq(schema.workflowStages.workflowId, workflow.id));
    const [a, b] = stages.sort((x, y) => x.position - y.position);

    await callerAs({ userId: engMember.id, systemRole: "user" }).reorderStages({ workflowId: workflow.id, stageIds: [b.id, a.id] });

    const reordered = await db.select().from(schema.workflowStages).where(eq(schema.workflowStages.workflowId, workflow.id));
    const byId = new Map(reordered.map((s) => [s.id, s.position]));
    expect(byId.get(b.id)).toBe(0);
    expect(byId.get(a.id)).toBe(1);
  });
});

describe("workflow.setStageStatus", () => {
  it("updates a stage's status", async () => {
    const workflow = await callerAs({ userId: engMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      name: "Status update test",
      stages: ["Only"],
    });
    createdWorkflowIds.push(workflow.id);
    const [stage] = await db.select().from(schema.workflowStages).where(eq(schema.workflowStages.workflowId, workflow.id));

    const updated = await callerAs({ userId: engMember.id, systemRole: "user" }).setStageStatus({ stageId: stage.id, status: "done" });
    expect(updated.status).toBe("done");
  });

  it("rejects a non-manager", async () => {
    const workflow1 = await mustWorkflow("Session bug fix process");
    const [stage] = await db.select().from(schema.workflowStages).where(eq(schema.workflowStages.workflowId, workflow1.id));
    await expect(
      callerAs({ userId: marketingMember.id, systemRole: "user" }).setStageStatus({ stageId: stage.id, status: "done" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("workflow.attachArtifact / detachArtifact", () => {
  it("attaches any kind, including kit, and detach removes it", async () => {
    const workflow = await callerAs({ userId: engMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      name: "Attach any-kind test",
      stages: ["Only"],
    });
    createdWorkflowIds.push(workflow.id);
    const [stage] = await db.select().from(schema.workflowStages).where(eq(schema.workflowStages.workflowId, workflow.id));

    const kit1 = await mustArtifact("Code review starter kit");
    await callerAs({ userId: engMember.id, systemRole: "user" }).attachArtifact({ stageId: stage.id, artifactId: kit1.id });

    const got = await callerAs({ userId: engMember.id, systemRole: "user" }).get({ id: workflow.id });
    expect(got.stages[0].artifacts.map((a) => a.id)).toContain(kit1.id);

    await callerAs({ userId: engMember.id, systemRole: "user" }).detachArtifact({ stageId: stage.id, artifactId: kit1.id });
    const after = await callerAs({ userId: engMember.id, systemRole: "user" }).get({ id: workflow.id });
    expect(after.stages[0].artifacts.map((a) => a.id)).not.toContain(kit1.id);
  });

  it("rejects attaching an artifact the caller cannot read", async () => {
    // marketingMember manages a "content" team workflow but has no read
    // access to plan1 (backend team's own group-visibility plan).
    const workflow = await callerAs({ userId: marketingMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: content.id,
      name: "Content attach-unreadable test",
      stages: ["Only"],
    });
    createdWorkflowIds.push(workflow.id);
    const [stage] = await db.select().from(schema.workflowStages).where(eq(schema.workflowStages.workflowId, workflow.id));

    const plan1 = await mustArtifact("Sửa lỗi phiên đăng nhập hết hạn sớm");
    await expect(
      callerAs({ userId: marketingMember.id, systemRole: "user" }).attachArtifact({ stageId: stage.id, artifactId: plan1.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("workflow.delete — audit", () => {
  it("cascades to stages/attachments and writes exactly one audit event", async () => {
    await db.delete(schema.auditEvents);

    const workflow = await callerAs({ userId: engMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      name: "Delete audit test",
      stages: ["Only"],
    });

    await callerAs({ userId: engMember.id, systemRole: "user" }).delete({ id: workflow.id });

    const remaining = await db.select().from(schema.workflows).where(eq(schema.workflows.id, workflow.id));
    expect(remaining).toHaveLength(0);
    const remainingStages = await db.select().from(schema.workflowStages).where(eq(schema.workflowStages.workflowId, workflow.id));
    expect(remainingStages).toHaveLength(0);

    const events = await db.select().from(schema.auditEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: engMember.id,
      action: "workflow.delete",
      targetType: "workflow",
      targetId: workflow.id,
    });
  });
});
