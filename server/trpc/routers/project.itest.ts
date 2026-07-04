import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createTestDb } from "@/server/test-support/test-db";
import * as schema from "@/server/db/schema";
import { projectRouter } from "./project";
import type { Context } from "@/server/trpc/context";

const { db, close } = createTestDb();

type Identity = { userId: string; systemRole: "user" | "superadmin" };

function callerAs(identity: Identity) {
  const ctx: Context = { db, session: identity };
  return projectRouter.createCaller(ctx);
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
let backend: typeof schema.teams.$inferSelect;
let content: typeof schema.teams.$inferSelect;

// Every project created inside these tests is tracked and deleted in
// afterAll — the seeded "Session bug fix" project is left untouched (other
// test files may assume it still exists).
const createdProjectIds: string[] = [];

beforeAll(async () => {
  superadmin = await mustUser("superadmin@test.local");
  orgAdmin = await mustUser("org-admin@test.local");
  orgViewer = await mustUser("org-viewer@test.local");
  engMember = await mustUser("eng-member@test.local");
  marketingMember = await mustUser("marketing-member@test.local");
  outsider = await mustUser("outsider@test.local");
  [backend] = await db.select().from(schema.teams).where(eq(schema.teams.slug, "backend"));
  [content] = await db.select().from(schema.teams).where(eq(schema.teams.slug, "content"));
});

afterAll(async () => {
  if (createdProjectIds.length > 0) {
    await db.delete(schema.projects).where(inArray(schema.projects.id, createdProjectIds));
  }
  await close();
});

describe("project.create", () => {
  it("allows a team editor to create a project owned by their own team", async () => {
    const project = await callerAs({ userId: engMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      name: "Backend refactor tracking",
    });
    createdProjectIds.push(project.id);
    expect(project.ownerGroupType).toBe("team");
    expect(project.ownerGroupId).toBe(backend.id);
  });

  it("allows an org admin to create a project owned by a descendant team (D-016 downward mutate)", async () => {
    const project = await callerAs({ userId: orgAdmin.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: content.id,
      name: "Content team project",
    });
    createdProjectIds.push(project.id);
    expect(project.ownerGroupId).toBe(content.id);
  });

  it("rejects a user with no role in the owning group's chain", async () => {
    await expect(
      callerAs({ userId: marketingMember.id, systemRole: "user" }).create({
        ownerGroupType: "team",
        ownerGroupId: backend.id,
        name: "Should not be created",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("project.list / listMine — cone visibility (D-016)", () => {
  it("an outsider with no membership anywhere sees no projects", async () => {
    const list = await callerAs({ userId: outsider.id, systemRole: "user" }).list();
    expect(list).toEqual([]);
  });

  it("a different team's member does not see a project owned by another team", async () => {
    const list = await callerAs({ userId: marketingMember.id, systemRole: "user" }).list();
    expect(list.find((p) => p.name === "Session bug fix")).toBeUndefined();
  });

  it("an org-level viewer sees a descendant team's project (read inherits down for every role)", async () => {
    const list = await callerAs({ userId: orgViewer.id, systemRole: "user" }).list();
    expect(list.find((p) => p.name === "Session bug fix")).toBeDefined();
  });

  it("the owning team's editor sees the project, with artifact + member counts and canManage=true", async () => {
    const list = await callerAs({ userId: engMember.id, systemRole: "user" }).list();
    const found = list.find((p) => p.name === "Session bug fix");
    expect(found).toBeDefined();
    expect(found!.artifactCount).toBe(2);
    expect(found!.memberCount).toBe(1);
    expect(found!.canManage).toBe(true);
  });

  it("reports canManage=false for a viewer-only caller in list()", async () => {
    const list = await callerAs({ userId: orgViewer.id, systemRole: "user" }).list();
    const found = list.find((p) => p.name === "Session bug fix");
    expect(found?.canManage).toBe(false);
  });

  it("listMine returns only projects the caller is a member of", async () => {
    const mine = await callerAs({ userId: engMember.id, systemRole: "user" }).listMine();
    expect(mine.find((p) => p.name === "Session bug fix")).toBeDefined();

    const marketingMine = await callerAs({ userId: marketingMember.id, systemRole: "user" }).listMine();
    expect(marketingMine).toEqual([]);
  });
});

describe("project.get", () => {
  it("throws FORBIDDEN for a caller outside the owning group's cone", async () => {
    const project1 = await mustProject("Session bug fix");
    await expect(
      callerAs({ userId: outsider.id, systemRole: "user" }).get({ id: project1.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reports canManage=false for a viewer, true for an editor/admin", async () => {
    const project1 = await mustProject("Session bug fix");

    const asViewer = await callerAs({ userId: orgViewer.id, systemRole: "user" }).get({ id: project1.id });
    expect(asViewer.canManage).toBe(false);

    const asEditor = await callerAs({ userId: engMember.id, systemRole: "user" }).get({ id: project1.id });
    expect(asEditor.canManage).toBe(true);

    const asOrgAdmin = await callerAs({ userId: orgAdmin.id, systemRole: "user" }).get({ id: project1.id });
    expect(asOrgAdmin.canManage).toBe(true);
  });

  it("returns the assigned doc + plan, filtered to what the viewer can read", async () => {
    const project1 = await mustProject("Session bug fix");
    const result = await callerAs({ userId: engMember.id, systemRole: "user" }).get({ id: project1.id });
    expect(result.artifacts.map((a) => a.title).sort()).toEqual(
      ["Lỗi: phiên đăng nhập hết hạn sau 5 phút", "Sửa lỗi phiên đăng nhập hết hạn sớm"].sort(),
    );
    expect(result.members.map((m) => m.id)).toEqual([engMember.id]);
  });
});

describe("project.update / delete — manage gate", () => {
  it("rejects a non-editor/admin caller (org viewer)", async () => {
    const project1 = await mustProject("Session bug fix");
    await expect(
      callerAs({ userId: orgViewer.id, systemRole: "user" }).update({ id: project1.id, name: "Hacked" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a caller with no role anywhere in the chain", async () => {
    const project1 = await mustProject("Session bug fix");
    await expect(
      callerAs({ userId: marketingMember.id, systemRole: "user" }).delete({ id: project1.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows the owning team's editor to update", async () => {
    const project = await callerAs({ userId: engMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      name: "Update target",
    });
    createdProjectIds.push(project.id);

    const updated = await callerAs({ userId: engMember.id, systemRole: "user" }).update({
      id: project.id,
      description: "Now with a description",
    });
    expect(updated.description).toBe("Now with a description");
  });
});

describe("project.assignArtifact / unassignArtifact", () => {
  it("rejects assigning a non-doc/plan artifact (kind mismatch)", async () => {
    const project1 = await mustProject("Session bug fix");
    const skill1 = await mustArtifact("PR review checklist");
    await expect(
      callerAs({ userId: engMember.id, systemRole: "user" }).assignArtifact({
        projectId: project1.id,
        artifactId: skill1.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects assigning an artifact the caller cannot read", async () => {
    // marketingMember manages a "content" team project but has no read
    // access to plan1 (backend team's own group-visibility plan).
    const contentProject = await callerAs({ userId: marketingMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: content.id,
      name: "Content assign test",
    });
    createdProjectIds.push(contentProject.id);

    const plan1 = await mustArtifact("Sửa lỗi phiên đăng nhập hết hạn sớm");
    await expect(
      callerAs({ userId: marketingMember.id, systemRole: "user" }).assignArtifact({
        projectId: contentProject.id,
        artifactId: plan1.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("assigns and unassigns a readable doc/plan", async () => {
    const project = await callerAs({ userId: engMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      name: "Assign roundtrip",
    });
    createdProjectIds.push(project.id);

    const plan2 = await mustArtifact("Migrate to Next.js 16");
    await callerAs({ userId: engMember.id, systemRole: "user" }).assignArtifact({
      projectId: project.id,
      artifactId: plan2.id,
    });

    const afterAssign = await callerAs({ userId: engMember.id, systemRole: "user" }).get({ id: project.id });
    expect(afterAssign.artifacts.map((a) => a.id)).toContain(plan2.id);

    await callerAs({ userId: engMember.id, systemRole: "user" }).unassignArtifact({
      projectId: project.id,
      artifactId: plan2.id,
    });

    const afterUnassign = await callerAs({ userId: engMember.id, systemRole: "user" }).get({ id: project.id });
    expect(afterUnassign.artifacts.map((a) => a.id)).not.toContain(plan2.id);
  });
});

describe("project.assignArtifactsBulk (Phase 45 B2)", () => {
  it("assigns readable doc/plan ids, skips a wrong-kind id", async () => {
    const project = await callerAs({ userId: engMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      name: "Bulk assign roundtrip",
    });
    createdProjectIds.push(project.id);

    const plan2 = await mustArtifact("Migrate to Next.js 16");
    const skill1 = await mustArtifact("PR review checklist");

    const result = await callerAs({ userId: engMember.id, systemRole: "user" }).assignArtifactsBulk({
      projectId: project.id,
      artifactIds: [plan2.id, skill1.id],
    });

    expect(result.assignedIds).toEqual([plan2.id]);
    expect(result.skippedIds).toEqual([skill1.id]);

    const after = await callerAs({ userId: engMember.id, systemRole: "user" }).get({ id: project.id });
    expect(after.artifacts.map((a) => a.id)).toContain(plan2.id);
  });

  it("skips an artifact the caller cannot read", async () => {
    const contentProject = await callerAs({ userId: marketingMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: content.id,
      name: "Bulk assign unreadable test",
    });
    createdProjectIds.push(contentProject.id);

    const plan1 = await mustArtifact("Sửa lỗi phiên đăng nhập hết hạn sớm"); // backend team, unreadable to marketingMember

    const result = await callerAs({ userId: marketingMember.id, systemRole: "user" }).assignArtifactsBulk({
      projectId: contentProject.id,
      artifactIds: [plan1.id],
    });

    expect(result.assignedIds).toEqual([]);
    expect(result.skippedIds).toEqual([plan1.id]);
  });
});

describe("project.addMember / removeMember", () => {
  it("rejects adding a user outside the owning group's cone", async () => {
    const project1 = await mustProject("Session bug fix");
    await expect(
      callerAs({ userId: engMember.id, systemRole: "user" }).addMember({
        projectId: project1.id,
        userId: marketingMember.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("adds and removes a member within the cone", async () => {
    const project = await callerAs({ userId: engMember.id, systemRole: "user" }).create({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      name: "Member roundtrip",
    });
    createdProjectIds.push(project.id);

    // orgAdmin's org membership covers backend team's cone (D-016).
    await callerAs({ userId: engMember.id, systemRole: "user" }).addMember({
      projectId: project.id,
      userId: orgAdmin.id,
    });

    const mine = await callerAs({ userId: orgAdmin.id, systemRole: "user" }).listMine();
    expect(mine.find((p) => p.id === project.id)).toBeDefined();

    await callerAs({ userId: engMember.id, systemRole: "user" }).removeMember({
      projectId: project.id,
      userId: orgAdmin.id,
    });

    const mineAfter = await callerAs({ userId: orgAdmin.id, systemRole: "user" }).listMine();
    expect(mineAfter.find((p) => p.id === project.id)).toBeUndefined();
  });
});

describe("project.listForArtifact", () => {
  it("returns the seeded project for its assigned plan, with canManage per caller", async () => {
    const plan1 = await mustArtifact("Sửa lỗi phiên đăng nhập hết hạn sớm");

    const asEditor = await callerAs({ userId: engMember.id, systemRole: "user" }).listForArtifact({
      artifactId: plan1.id,
    });
    expect(asEditor.find((p) => p.name === "Session bug fix")?.canManage).toBe(true);

    const asViewer = await callerAs({ userId: orgViewer.id, systemRole: "user" }).listForArtifact({
      artifactId: plan1.id,
    });
    expect(asViewer.find((p) => p.name === "Session bug fix")?.canManage).toBe(false);
  });

  it("excludes projects the caller cannot view, even if the artifact itself is public", async () => {
    // marketingMember has no membership covering backend team's cone, so the
    // seeded project must not show up for them — even though they might be
    // able to read the plan via some other path (they aren't here, but the
    // filter is on project visibility, not artifact visibility).
    const plan1 = await mustArtifact("Sửa lỗi phiên đăng nhập hết hạn sớm");
    const forMarketing = await callerAs({ userId: marketingMember.id, systemRole: "user" }).listForArtifact({
      artifactId: plan1.id,
    });
    expect(forMarketing).toEqual([]);
  });

  it("returns an empty list for an artifact assigned to no project", async () => {
    const plan3 = await mustArtifact("Kế hoạch onboarding nhân viên mới");
    const result = await callerAs({ userId: engMember.id, systemRole: "user" }).listForArtifact({
      artifactId: plan3.id,
    });
    expect(result).toEqual([]);
  });
});

describe("project — superadmin bypass", () => {
  it("can create, view, and manage a project regardless of membership", async () => {
    const project = await callerAs({ userId: superadmin.id, systemRole: "superadmin" }).create({
      ownerGroupType: "team",
      ownerGroupId: content.id,
      name: "Superadmin project",
    });
    createdProjectIds.push(project.id);

    const fetched = await callerAs({ userId: superadmin.id, systemRole: "superadmin" }).get({ id: project.id });
    expect(fetched.canManage).toBe(true);
  });
});
