import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTestDb } from "@/server/test-support/test-db";
import * as schema from "@/server/db/schema";
import { slugify } from "@/lib/slug";
import { createArtifact } from "@/server/services/artifact";
import { createMcpServer } from "./server";
import type { TokenScope } from "./scope";

/**
 * Exercises the MCP server end-to-end (protocol layer included) against the
 * seeded qa fixtures — see server/db/seed-test.ts for exactly what each user
 * can see. Uses the SDK's in-process transport pair instead of HTTP so these
 * assertions only depend on createMcpServer(), not on the route handler.
 */

const { db, close } = createTestDb();

type Identity = { userId: string; systemRole: "user" | "superadmin" };

async function connect(identity: Identity, scope: TokenScope = {}) {
  const server = await createMcpServer(identity, scope);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "itest-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function text(result: unknown): string {
  const content = (result as { content?: unknown[] }).content ?? [];
  return (content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

async function mustArtifact(title: string) {
  const [row] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.title, title));
  if (!row) throw new Error(`fixture artifact not found: ${title}`);
  return row;
}

async function mustWorkflow(name: string) {
  const [row] = await db.select().from(schema.workflows).where(eq(schema.workflows.name, name));
  if (!row) throw new Error(`fixture workflow not found: ${name}`);
  return row;
}

async function mustProject(name: string) {
  const [row] = await db.select().from(schema.projects).where(eq(schema.projects.name, name));
  if (!row) throw new Error(`fixture project not found: ${name}`);
  return row;
}

async function mustStage(workflowId: string, name: string) {
  const [row] = await db
    .select()
    .from(schema.workflowStages)
    .where(and(eq(schema.workflowStages.workflowId, workflowId), eq(schema.workflowStages.name, name)));
  if (!row) throw new Error(`fixture stage not found: ${name}`);
  return row;
}

const ORG_PATH = "qa-org";
const ENG_PATH = "qa-org.engineering";
const BACKEND_PATH = "qa-org.engineering.backend";

let engMember: typeof schema.users.$inferSelect;
let marketingMember: typeof schema.users.$inferSelect;
let outsider: typeof schema.users.$inferSelect;
let orgAdmin: typeof schema.users.$inferSelect;
let orgViewer: typeof schema.users.$inferSelect;
let backend: typeof schema.teams.$inferSelect;

let prompt1Slug: string;
let prompt2Slug: string;
let prompt3Slug: string;
let skill1Slug: string;
let skill2Slug: string;
let kit1Slug: string;
let kit3Slug: string;
let plan1Slug: string;
let plan2Slug: string;
let doc1Slug: string;

beforeAll(async () => {
  [engMember] = await db.select().from(schema.users).where(eq(schema.users.email, "eng-member@test.local"));
  [marketingMember] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, "marketing-member@test.local"));
  [outsider] = await db.select().from(schema.users).where(eq(schema.users.email, "outsider@test.local"));
  [orgAdmin] = await db.select().from(schema.users).where(eq(schema.users.email, "org-admin@test.local"));
  [orgViewer] = await db.select().from(schema.users).where(eq(schema.users.email, "org-viewer@test.local"));
  [backend] = await db.select().from(schema.teams).where(eq(schema.teams.slug, "backend"));

  const prompt1 = await mustArtifact("Rà soát bảo mật mã nguồn");
  const prompt2 = await mustArtifact("Summarize meeting notes");
  const prompt3 = await mustArtifact("Viết email xin nghỉ phép");
  const skill1 = await mustArtifact("PR review checklist");
  const skill2 = await mustArtifact("Hướng dẫn viết test tự động");
  const kit1 = await mustArtifact("Code review starter kit");
  const kit3 = await mustArtifact("Meta kit");
  const plan1 = await mustArtifact("Sửa lỗi phiên đăng nhập hết hạn sớm");
  const plan2 = await mustArtifact("Migrate to Next.js 16");
  const doc1 = await mustArtifact("Lỗi: phiên đăng nhập hết hạn sau 5 phút");

  prompt1Slug = `${BACKEND_PATH}.${prompt1.slug}`;
  prompt2Slug = `${prompt2.slug}`;
  prompt3Slug = `${ORG_PATH}.${prompt3.slug}`;
  skill1Slug = `${BACKEND_PATH}.${slugify(skill1.title)}`;
  skill2Slug = `${ENG_PATH}.${slugify(skill2.title)}`;
  kit1Slug = `${BACKEND_PATH}.${slugify(kit1.title)}`;
  kit3Slug = slugify(kit3.title);
  plan1Slug = `${BACKEND_PATH}.${slugify(plan1.title)}`;
  plan2Slug = `${ENG_PATH}.${slugify(plan2.title)}`;
  doc1Slug = `${BACKEND_PATH}.${slugify(doc1.title)}`;
});

afterAll(() => close());

describe("D-016: read access inherits downward too (org-admin, no direct team/dept membership)", () => {
  it("org-admin's list_skills includes a descendant team's group skill", async () => {
    const client = await connect({ userId: orgAdmin.id, systemRole: "user" });
    const result = await client.callTool({ name: "list_skills", arguments: {} });
    expect(text(result)).toContain(skill1Slug); // owned by team backend, under org-admin's org
  });
});

describe("prompts primitive", () => {
  it("lists the namespaced team prompt and the personal prompt for eng-member", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name);
    expect(names).toContain(prompt1Slug);
    expect(names).toContain(prompt2Slug);
  });

  it("renders {{var}} template arguments via getPrompt", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.getPrompt({ name: prompt1Slug, arguments: { diff: "+ const x = 1" } });
    const content = result.messages[0].content as { type: string; text: string };
    expect(content.type).toBe("text");
    expect(content.text).toContain("+ const x = 1");
  });

  it("outsider only sees the public prompt", async () => {
    const client = await connect({ userId: outsider.id, systemRole: "user" });
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name);
    expect(names).toContain(prompt3Slug);
    expect(names).not.toContain(prompt1Slug);
    expect(names).not.toContain(prompt2Slug);
  });
});

describe("write gate", () => {
  it("read-only scope exposes exactly the 18 read tools", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, {});
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "get_doc",
        "get_kit",
        "get_plan",
        "get_project",
        "get_prompt",
        "get_skill",
        "get_workflow",
        "list_docs",
        "list_groups",
        "list_kits",
        "list_plans",
        "list_projects",
        "list_skills",
        "list_workflows",
        "overview",
        "pull_kit",
        "pull_skill",
        "search_artifacts",
      ].sort(),
    );
  });

  it("write:true scope adds the 20 write tools (38 total)", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(38);
    const names = new Set(tools.map((t) => t.name));
    for (const n of [
      "update_task_status",
      "add_plan_task",
      "update_plan_task",
      "delete_plan_task",
      "create_plan",
      "update_plan",
      "delete_plan",
      "create_doc",
      "update_doc",
      "delete_doc",
      "create_skill",
      "update_skill",
      "delete_skill",
      "create_prompt",
      "update_prompt",
      "delete_prompt",
      "set_workflow_stage_status",
      "attach_artifact_to_workflow_stage",
      "add_artifact_to_project",
      "remove_artifact_from_project",
    ]) {
      expect(names.has(n)).toBe(true);
    }
  });
});

describe("get_skill", () => {
  it("returns the body and bundled file content for a valid slug", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({ name: "get_skill", arguments: { slug: skill1Slug } });
    const t = text(result);
    expect(t).toContain("PR review checklist");
    expect(t).toContain("checklist.md");
    expect(t).toContain("Tests pass");
  });

  it("returns a friendly message (not a thrown error) for an unknown slug", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({ name: "get_skill", arguments: { slug: "does-not-exist" } });
    expect(text(result)).toContain("not found");
  });
});

describe("get_kit recursive flatten", () => {
  it("flattens Meta kit (kit3 -> kit1 -> prompt1+skill1, plus prompt2) recursively", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({ name: "get_kit", arguments: { slug: kit3Slug } });
    const t = text(result);
    expect(t).toContain(`/${prompt1Slug}`);
    expect(t).toContain(`/${prompt2Slug}`);
    expect(t).toContain(`get_skill('${skill1Slug}')`);
  });
});

describe("pull_skill / pull_kit (CLI JSON bundles, Phase 42 M2)", () => {
  it("pull_skill returns a JSON bundle with body, files, and version metadata", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({ name: "pull_skill", arguments: { slug: skill1Slug } });
    const bundle = JSON.parse(text(result));
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.kind).toBe("skill");
    expect(bundle.slug).toBe(skill1Slug);
    expect(bundle.title).toBe("PR review checklist");
    expect(bundle.body).toContain("checklist.md");
    expect(bundle.files).toEqual([
      expect.objectContaining({ path: "checklist.md" }),
    ]);
    expect(bundle.versionNo).toBe(1);
    expect(typeof bundle.updatedAt).toBe("string");
  });

  it("pull_skill returns an error object (not a thrown error) for an unknown slug", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({ name: "pull_skill", arguments: { slug: "does-not-exist" } });
    const bundle = JSON.parse(text(result));
    expect(bundle.error).toContain("not found");
  });

  it("pull_skill on a team-only skill is invisible to an outsider (same access gate as get_skill)", async () => {
    const client = await connect({ userId: outsider.id, systemRole: "user" });
    const result = await client.callTool({ name: "pull_skill", arguments: { slug: skill1Slug } });
    const bundle = JSON.parse(text(result));
    expect(bundle.error).toContain("not found");
  });

  it("pull_kit returns the kit plus every recursively-flattened member, fully resolved", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({ name: "pull_kit", arguments: { slug: kit3Slug } });
    const bundle = JSON.parse(text(result));
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.kind).toBe("kit");
    expect(bundle.title).toBe("Meta kit");

    const promptSlugs = bundle.prompts.map((p: { slug: string }) => p.slug);
    expect(promptSlugs).toContain(prompt1Slug);
    expect(promptSlugs).toContain(prompt2Slug);

    expect(bundle.skills).toHaveLength(1);
    expect(bundle.skills[0].slug).toBe(skill1Slug);
    expect(bundle.skills[0].files).toEqual([
      expect.objectContaining({ path: "checklist.md" }),
    ]);
  });
});

describe("plan and doc reads", () => {
  it("get_plan reports progress across all 3 task statuses and its linked doc", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({ name: "get_plan", arguments: { slug: plan1Slug } });
    const t = text(result);
    expect(t).toContain("Progress: 1/3 done");
    expect(t).toContain("[x]");
    expect(t).toContain("[~]");
    expect(t).toContain("[ ]");
    expect(t).toContain("Tái hiện lỗi ở local");
    expect(t).toContain("## Linked docs");
    expect(t).toContain(doc1Slug);
  });

  it("get_doc returns the full body", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({ name: "get_doc", arguments: { slug: doc1Slug } });
    const t = text(result);
    expect(t).toContain("Lỗi: phiên đăng nhập hết hạn sau 5 phút");
    expect(t).toContain("session.maxAge");
  });
});

describe("workflow tools", () => {
  it("list_workflows shows progress, active stage, and linked project for eng-member", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({ name: "list_workflows", arguments: {} });
    const t = text(result);
    expect(t).toContain("Session bug fix process");
    expect(t).toContain("1/3 stages done");
    expect(t).toContain("now: Build");
    expect(t).toContain("project: Session bug fix");
  });

  it("org-admin sees the workflow too (D-016 downward inheritance, no direct team membership)", async () => {
    const client = await connect({ userId: orgAdmin.id, systemRole: "user" });
    const result = await client.callTool({ name: "list_workflows", arguments: {} });
    expect(text(result)).toContain("Session bug fix process");
  });

  it("outsider sees no workflows (empty cone)", async () => {
    const client = await connect({ userId: outsider.id, systemRole: "user" });
    const result = await client.callTool({ name: "list_workflows", arguments: {} });
    expect(text(result)).toBe("No workflows available.");
  });

  it("get_workflow returns ordered stages with status markers and artifact references", async () => {
    const workflow = await mustWorkflow("Session bug fix process");
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({ name: "get_workflow", arguments: { id: workflow.id } });
    const t = text(result);

    expect(t).toContain("Progress: 1/3 stages done");
    expect(t.indexOf("[x] Spec")).toBeGreaterThanOrEqual(0);
    expect(t.indexOf("[x] Spec")).toBeLessThan(t.indexOf("[~] Build"));
    expect(t.indexOf("[~] Build")).toBeLessThan(t.indexOf("[ ] Review"));

    // Each stage heading carries its own id (P48 B0 fix) — without this,
    // set_workflow_stage_status/attach_artifact_to_workflow_stage have no
    // way for an agent to name a specific stage.
    const specStage = await mustStage(workflow.id, "Spec");
    expect(t).toContain(`Spec (id: ${specStage.id})`);

    // Spec -> doc1, as a reference (kind + usage hint), not full body content
    expect(t).toContain(`[doc] Lỗi: phiên đăng nhập hết hạn sau 5 phút`);
    expect(t).toContain(`get_doc('${doc1Slug}')`);
    expect(t).not.toContain("session.maxAge"); // that's doc1's body — must not leak here

    // Build -> kit1 + skill1 + plan1
    expect(t).toContain("[kit] Code review starter kit");
    expect(t).toContain(`get_kit('${kit1Slug}')`);
    expect(t).toContain("[skill] PR review checklist");
    expect(t).toContain(`get_skill('${skill1Slug}')`);
    expect(t).toContain("[plan] Sửa lỗi phiên đăng nhập hết hạn sớm");
    expect(t).toContain(`get_plan('${plan1Slug}')`);

    // Review -> nothing attached
    expect(t).toContain("_Nothing attached._");
  });

  it("returns a friendly message (not a thrown error) for an unknown id", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({
      name: "get_workflow",
      arguments: { id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(text(result)).toContain("not found");
  });

  it("denies access for an outsider (cannot view the owning team's workflow)", async () => {
    const workflow = await mustWorkflow("Session bug fix process");
    const client = await connect({ userId: outsider.id, systemRole: "user" });
    const result = await client.callTool({ name: "get_workflow", arguments: { id: workflow.id } });
    expect(text(result)).toContain("Access denied");
  });

  it("scope.tags filters stage artifact references the same way it filters list/get elsewhere", async () => {
    const workflow = await mustWorkflow("Session bug fix process");
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { tags: ["engineering"] });
    const result = await client.callTool({ name: "get_workflow", arguments: { id: workflow.id } });
    const t = text(result);

    // doc1 (tags: bug) and plan1 (tags: bug) fall outside the "engineering" scope
    expect(t).not.toContain("Lỗi: phiên đăng nhập hết hạn sau 5 phút");
    expect(t).not.toContain("Sửa lỗi phiên đăng nhập hết hạn sớm");
    // kit1 (engineering) and skill1 (engineering, review) still pass
    expect(t).toContain("[kit] Code review starter kit");
    expect(t).toContain("[skill] PR review checklist");
    // Spec's only attachment (doc1) was scoped out, so it now reads as empty
    expect(t).toContain("_Nothing attached._");
  });
});

describe("overview tool", () => {
  it("gives eng-member an access summary, artifact counts, in-flight workflow, and next-step hint", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({ name: "overview", arguments: {} });
    const t = text(result);

    expect(t).toContain(BACKEND_PATH);
    expect(t).toMatch(/\*\*Artifacts you can reach\*\*: \d+ prompts, \d+ skills, \d+ kits, \d+ plans, \d+ docs/);
    expect(t).toContain("## In-flight workflows");
    expect(t).toContain("now: Build");
    expect(t).toContain("Next:");
    expect(t).toContain("search_artifacts");
  });

  it("outsider sees no reachable spaces and no in-flight workflows", async () => {
    const client = await connect({ userId: outsider.id, systemRole: "user" });
    const result = await client.callTool({ name: "overview", arguments: {} });
    const t = text(result);

    expect(t).not.toContain(BACKEND_PATH);
    expect(t).toContain("## In-flight workflows");
    expect(t).toContain("_None");
  });

  it("surfaces frequently-used artifacts once fetchCount is set", async () => {
    const doc1 = await mustArtifact("Lỗi: phiên đăng nhập hết hạn sau 5 phút");
    const originalCount = doc1.fetchCount;
    await db.update(schema.artifacts).set({ fetchCount: 999 }).where(eq(schema.artifacts.id, doc1.id));

    try {
      const client = await connect({ userId: engMember.id, systemRole: "user" });
      const result = await client.callTool({ name: "overview", arguments: {} });
      const t = text(result);
      expect(t).toContain("## Frequently used");
      expect(t).toContain("[doc] Lỗi: phiên đăng nhập hết hạn sau 5 phút (999 uses)");
    } finally {
      await db.update(schema.artifacts).set({ fetchCount: originalCount }).where(eq(schema.artifacts.id, doc1.id));
    }
  });

  it("superadmin sees 'all spaces' regardless of cone", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "superadmin" });
    const result = await client.callTool({ name: "overview", arguments: {} });
    expect(text(result)).toContain("all spaces (superadmin)");
  });
});

describe("project tools", () => {
  it("list_projects shows doc/plan, member, and workflow counts for eng-member", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({ name: "list_projects", arguments: {} });
    const t = text(result);
    expect(t).toContain("Session bug fix");
    expect(t).toContain("2 doc/plan");
    expect(t).toContain("1 member");
    expect(t).toContain("1 workflow");
  });

  it("outsider sees no projects (empty cone)", async () => {
    const client = await connect({ userId: outsider.id, systemRole: "user" });
    const result = await client.callTool({ name: "list_projects", arguments: {} });
    expect(text(result)).toBe("No projects available.");
  });

  it("get_project returns assigned doc/plan references and the linked workflow with progress", async () => {
    const project = await mustProject("Session bug fix");
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({ name: "get_project", arguments: { id: project.id } });
    const t = text(result);

    expect(t).toContain("## Docs & plans");
    expect(t).toContain("[doc] Lỗi: phiên đăng nhập hết hạn sau 5 phút");
    expect(t).toContain(`get_doc('${doc1Slug}')`);
    expect(t).toContain("[plan] Sửa lỗi phiên đăng nhập hết hạn sớm");
    expect(t).toContain(`get_plan('${plan1Slug}')`);
    expect(t).not.toContain("session.maxAge"); // doc1's body — must not leak here

    expect(t).toContain("## Linked workflows");
    expect(t).toContain("Session bug fix process (1/3 stages done)");
  });

  it("returns a friendly message (not a thrown error) for an unknown id", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({
      name: "get_project",
      arguments: { id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(text(result)).toContain("not found");
  });

  it("denies access for an outsider (cannot view the owning team's project)", async () => {
    const project = await mustProject("Session bug fix");
    const client = await connect({ userId: outsider.id, systemRole: "user" });
    const result = await client.callTool({ name: "get_project", arguments: { id: project.id } });
    expect(text(result)).toContain("Access denied");
  });

  it("scope.tags filters assigned doc/plan references the same way it filters get_workflow", async () => {
    // plan1 and doc1 (this project's only assignments) are both tagged "bug",
    // not "engineering" — scoping to "engineering" should empty the section.
    const project = await mustProject("Session bug fix");
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { tags: ["engineering"] });
    const result = await client.callTool({ name: "get_project", arguments: { id: project.id } });
    const t = text(result);
    expect(t).not.toContain("Lỗi: phiên đăng nhập hết hạn sau 5 phút");
    expect(t).not.toContain("Sửa lỗi phiên đăng nhập hết hạn sớm");
    expect(t).toContain("_Nothing assigned._");
  });
});

describe("list_groups (Phase 52)", () => {
  it("returns eng-member's read cone with canWrite reflecting downward mutate authority", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const t = text(await client.callTool({ name: "list_groups", arguments: {} }));
    // Read cone inherits upward: backend (own, editor) + engineering + qa-org.
    expect(t).toContain(`[team] Backend (${BACKEND_PATH})`);
    expect(t).toContain(`[department] Engineering (${ENG_PATH})`);
    expect(t).toContain(`[org] QA Org (${ORG_PATH})`);
    // Mutate authority inherits downward only: editor on backend, nothing above.
    expect(t).toMatch(/\[team\] Backend .*canWrite: true/);
    expect(t).toMatch(/\[department\] Engineering .*canWrite: false/);
    expect(t).toMatch(/\[org\] QA Org .*canWrite: false/);
  });

  it("writableOnly filters to groups eng-member can actually create in", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const t = text(await client.callTool({ name: "list_groups", arguments: { writableOnly: true } }));
    expect(t).toContain("[team] Backend");
    expect(t).not.toContain("Engineering");
    expect(t).not.toContain("QA Org");
  });

  it("tells an outsider there are no group spaces (personal still available)", async () => {
    const client = await connect({ userId: outsider.id, systemRole: "user" });
    const t = text(await client.callTool({ name: "list_groups", arguments: {} }));
    expect(t).toContain("No group spaces available");
    expect(t).toContain("personal space");
  });

  it("superadmin sees every group, all writable", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "superadmin" });
    const t = text(await client.callTool({ name: "list_groups", arguments: {} }));
    for (const name of ["QA Org", "Engineering", "Marketing", "Backend", "Content"]) {
      expect(t).toContain(name);
    }
    expect(t).not.toMatch(/canWrite: false/);
  });
});

describe("add/remove_artifact_to_project (Phase 52)", () => {
  it("assigns then removes a plan (round trip), reporting no-op on a second remove", async () => {
    const project = await mustProject("Session bug fix");

    // Assign plan2 (owned by Engineering, readable by eng-member; not yet in the project).
    const assign = text(
      await (await connect({ userId: engMember.id, systemRole: "user" }, { write: true })).callTool({
        name: "add_artifact_to_project",
        arguments: { projectId: project.id, slug: plan2Slug },
      }),
    );
    expect(assign).toContain("assigned to project 'Session bug fix'");

    // A fresh connection's get_project now lists it.
    const view = text(
      await (await connect({ userId: engMember.id, systemRole: "user" })).callTool({
        name: "get_project",
        arguments: { id: project.id },
      }),
    );
    expect(view).toContain("Migrate to Next.js 16");

    // Remove it, then a second remove is a reported no-op.
    const remove = text(
      await (await connect({ userId: engMember.id, systemRole: "user" }, { write: true })).callTool({
        name: "remove_artifact_from_project",
        arguments: { projectId: project.id, slug: plan2Slug },
      }),
    );
    expect(remove).toContain("removed from project 'Session bug fix'");

    const removeAgain = text(
      await (await connect({ userId: engMember.id, systemRole: "user" }, { write: true })).callTool({
        name: "remove_artifact_from_project",
        arguments: { projectId: project.id, slug: plan2Slug },
      }),
    );
    expect(removeAgain).toContain("(no-op)");
  });

  it("reports 'already in' when assigning an artifact the project already has", async () => {
    const project = await mustProject("Session bug fix");
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const t = text(
      await client.callTool({ name: "add_artifact_to_project", arguments: { projectId: project.id, slug: plan1Slug } }),
    );
    expect(t).toContain("already in project 'Session bug fix'");
  });

  it("denies a viewer (can see the project but not manage it)", async () => {
    const project = await mustProject("Session bug fix");
    const client = await connect({ userId: orgViewer.id, systemRole: "user" }, { write: true });
    const t = text(
      await client.callTool({ name: "add_artifact_to_project", arguments: { projectId: project.id, slug: plan2Slug } }),
    );
    expect(t).toContain("Permission denied");
  });

  it("rejects a non-doc/plan slug and honours the kind disambiguator", async () => {
    const project = await mustProject("Session bug fix");
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });

    // A skill is neither doc nor plan → not resolvable.
    const skill = text(
      await client.callTool({ name: "add_artifact_to_project", arguments: { projectId: project.id, slug: skill1Slug } }),
    );
    expect(skill).toContain("No doc or plan found");

    // Passing the wrong kind for a real plan slug fails cleanly.
    const wrongKind = text(
      await client.callTool({
        name: "add_artifact_to_project",
        arguments: { projectId: project.id, slug: plan2Slug, kind: "doc" },
      }),
    );
    expect(wrongKind).toContain("not found");
  });

  it("asks for kind when a slug matches both a doc and a plan", async () => {
    // The (owner_type, owner_id, slug) unique constraint forbids a doc+plan
    // sharing a slug under the SAME owner, so ambiguity only arises across
    // spaces via the bare-localSlug alias the maps register: a personal plan
    // and a backend-team doc that share the local slug "dup-ambig-52".
    const dupSlug = "dup-ambig-52";
    const ambigPlan = await createArtifact(
      { kind: "plan", ownerType: "user", ownerId: engMember.id, title: "Ambig plan 52", slug: dupSlug, visibility: "private", createdBy: engMember.id, body: "x" },
      db,
    );
    const ambigDoc = await createArtifact(
      { kind: "doc", ownerType: "team", ownerId: backend.id, title: "Ambig doc 52", slug: dupSlug, visibility: "group", createdBy: engMember.id, body: "y" },
      db,
    );
    try {
      const project = await mustProject("Session bug fix");
      const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
      const t = text(
        await client.callTool({ name: "add_artifact_to_project", arguments: { projectId: project.id, slug: dupSlug } }),
      );
      expect(t).toContain("matches both a doc and a plan");
    } finally {
      // Keep the shared fixture set intact for other integration files (they
      // assert on the seeded artifact count).
      await db.delete(schema.artifacts).where(eq(schema.artifacts.id, ambigPlan.id));
      await db.delete(schema.artifacts).where(eq(schema.artifacts.id, ambigDoc.id));
    }
  });

  it("returns a friendly message for an unknown project id", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const t = text(
      await client.callTool({
        name: "add_artifact_to_project",
        arguments: { projectId: "00000000-0000-0000-0000-000000000000", slug: plan2Slug },
      }),
    );
    expect(t).toContain("not found");
  });
});

describe("doc resources (MCP resources primitive, Phase 42 M1)", () => {
  it("lists an accessible doc as a resource with the agenthub://doc/<slug> URI", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain(`agenthub://doc/${doc1Slug}`);
  });

  it("readResource returns the doc's full body as markdown", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.readResource({ uri: `agenthub://doc/${doc1Slug}` });
    expect(result.contents).toHaveLength(1);
    const content = result.contents[0];
    expect(content.mimeType).toBe("text/markdown");
    expect("text" in content && content.text).toContain("session.maxAge");
  });

  it("outsider's resource list excludes the team-only doc", async () => {
    const client = await connect({ userId: outsider.id, systemRole: "user" });
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).not.toContain(`agenthub://doc/${doc1Slug}`);
  });

  it("readResource rejects a URI not registered for this identity", async () => {
    const client = await connect({ userId: outsider.id, systemRole: "user" });
    await expect(client.readResource({ uri: `agenthub://doc/${doc1Slug}` })).rejects.toThrow();
  });
});

/**
 * bumpUsage() writes fire-and-forget (not awaited by the tool handler), so
 * these tests poll briefly instead of asserting immediately after the call.
 */
async function waitForFetchCount(artifactId: string, min: number, timeoutMs = 5000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, artifactId));
    if (row.fetchCount >= min) return row.fetchCount;
    if (Date.now() > deadline) {
      throw new Error(`fetchCount for ${artifactId} did not reach ${min} within ${timeoutMs}ms (got ${row.fetchCount})`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("usage analytics (fetchCount / lastFetchedAt)", () => {
  it("get_skill bumps fetchCount and sets lastFetchedAt", async () => {
    const skill1 = await mustArtifact("PR review checklist");
    const before = skill1.fetchCount;
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    await client.callTool({ name: "get_skill", arguments: { slug: skill1Slug } });
    const after = await waitForFetchCount(skill1.id, before + 1);
    expect(after).toBe(before + 1);
    const [row] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, skill1.id));
    expect(row.lastFetchedAt).not.toBeNull();
  });

  it("get_kit bumps the kit itself but not its recursively flattened members", async () => {
    const kit3 = await mustArtifact("Meta kit");
    const prompt1 = await mustArtifact("Rà soát bảo mật mã nguồn");
    const kitBefore = kit3.fetchCount;
    const promptBefore = prompt1.fetchCount;
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    await client.callTool({ name: "get_kit", arguments: { slug: kit3Slug } });
    const kitAfter = await waitForFetchCount(kit3.id, kitBefore + 1);
    expect(kitAfter).toBe(kitBefore + 1);
    const [promptRow] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, prompt1.id));
    expect(promptRow.fetchCount).toBe(promptBefore);
  });

  it("get_plan bumps fetchCount", async () => {
    const plan1 = await mustArtifact("Sửa lỗi phiên đăng nhập hết hạn sớm");
    const before = plan1.fetchCount;
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    await client.callTool({ name: "get_plan", arguments: { slug: plan1Slug } });
    const after = await waitForFetchCount(plan1.id, before + 1);
    expect(after).toBe(before + 1);
  });

  it("get_doc bumps fetchCount", async () => {
    const doc1 = await mustArtifact("Lỗi: phiên đăng nhập hết hạn sau 5 phút");
    const before = doc1.fetchCount;
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    await client.callTool({ name: "get_doc", arguments: { slug: doc1Slug } });
    const after = await waitForFetchCount(doc1.id, before + 1);
    expect(after).toBe(before + 1);
  });

  it("getPrompt bumps fetchCount for the underlying prompt artifact", async () => {
    const prompt1 = await mustArtifact("Rà soát bảo mật mã nguồn");
    const before = prompt1.fetchCount;
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    await client.getPrompt({ name: prompt1Slug, arguments: { diff: "+ const x = 1" } });
    const after = await waitForFetchCount(prompt1.id, before + 1);
    expect(after).toBe(before + 1);
  });

  it("list_skills and search_artifacts do not bump fetchCount", async () => {
    const skill1 = await mustArtifact("PR review checklist");
    const before = skill1.fetchCount;
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    await client.callTool({ name: "list_skills", arguments: {} });
    await client.callTool({ name: "search_artifacts", arguments: { query: "checklist" } });
    await new Promise((r) => setTimeout(r, 100));
    const [row] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, skill1.id));
    expect(row.fetchCount).toBe(before);
  });
});

describe("search_artifacts", () => {
  it("eng-member finds their team's group artifact by keyword", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({ name: "search_artifacts", arguments: { query: "checklist" } });
    expect(text(result)).toContain(skill1Slug);
  });

  it("outsider does not see the team-only artifact via search", async () => {
    const client = await connect({ userId: outsider.id, systemRole: "user" });
    const result = await client.callTool({ name: "search_artifacts", arguments: { query: "checklist" } });
    expect(text(result)).not.toContain(skill1Slug);
  });

  it("kinds filter restricts results to the requested kind", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" });
    const result = await client.callTool({
      name: "search_artifacts",
      arguments: { query: "review", kinds: ["skill"] },
    });
    const t = text(result);
    expect(t).toContain("[skill]");
    expect(t).not.toContain("[prompt]");
    expect(t).not.toContain("[kit]");
  });
});

describe("scope: spaces", () => {
  it("narrows list_skills to only the scoped team, excluding the dept-level skill", async () => {
    const client = await connect(
      { userId: engMember.id, systemRole: "user" },
      { spaces: [{ groupType: "team", groupId: backend.id }] },
    );
    const result = await client.callTool({ name: "list_skills", arguments: {} });
    const t = text(result);
    expect(t).toContain(skill1Slug);
    expect(t).not.toContain(skill2Slug);
  });

  it("space-scoped token excludes the token owner's own personal artifacts", async () => {
    const client = await connect(
      { userId: engMember.id, systemRole: "user" },
      { spaces: [{ groupType: "team", groupId: backend.id }] },
    );
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name);
    expect(names).toContain(prompt1Slug);
    expect(names).not.toContain(prompt2Slug);
  });
});

describe("scope: tags", () => {
  it("excludes artifacts whose tags don't overlap the scope tag list", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { tags: ["engineering"] });
    const result = await client.callTool({ name: "list_skills", arguments: {} });
    const t = text(result);
    expect(t).toContain(skill1Slug); // tags: engineering, review
    expect(t).not.toContain(skill2Slug); // tags: testing only
  });
});

describe("write round-trip (scope.write = true)", () => {
  // Uses plan2, not plan1 — plan1's task counts are asserted in the read-only
  // "plan and doc reads" group above, and mutating it here would make that
  // group's outcome depend on file execution order.
  it("update_task_status persists, verified via a fresh get_plan call", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const plan2 = await mustArtifact("Migrate to Next.js 16");
    const tasks = await db.query.artifactTasks.findMany({
      where: eq(schema.artifactTasks.artifactId, plan2.id),
      orderBy: schema.artifactTasks.position,
    });
    const todoTask = tasks.find((t) => t.status === "todo")!;

    const updateResult = await client.callTool({
      name: "update_task_status",
      arguments: { taskId: todoTask.id, status: "done" },
    });
    expect(text(updateResult)).toContain("Progress: 3/4 done");

    const planResult = await client.callTool({ name: "get_plan", arguments: { slug: plan2Slug } });
    expect(text(planResult)).toContain("Progress: 3/4 done");
  });

  it("add_plan_task, update_plan_task, delete_plan_task round-trip", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });

    const addResult = await client.callTool({
      name: "add_plan_task",
      arguments: { planSlug: plan2Slug, content: "Draft task from itest" },
    });
    const addText = text(addResult);
    expect(addText).toContain("Task added");
    const taskId = addText.match(/\(id: ([0-9a-f-]+)\)/)?.[1];
    if (!taskId) throw new Error(`could not parse task id from: ${addText}`);

    const updateResult = await client.callTool({
      name: "update_plan_task",
      arguments: { taskId, content: "Edited task from itest" },
    });
    expect(text(updateResult)).toContain("Task updated.");

    const [updatedRow] = await db.select().from(schema.artifactTasks).where(eq(schema.artifactTasks.id, taskId));
    expect(updatedRow.content).toBe("Edited task from itest");

    const deleteResult = await client.callTool({ name: "delete_plan_task", arguments: { taskId } });
    expect(text(deleteResult)).toContain("Task deleted.");

    const remaining = await db.select().from(schema.artifactTasks).where(eq(schema.artifactTasks.id, taskId));
    expect(remaining).toHaveLength(0);
  });

  it("create_plan and create_doc create new user-owned artifacts", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });

    const planResult = await client.callTool({
      name: "create_plan",
      arguments: { title: "Itest-created plan", body: "Created via MCP itest", tasks: ["first task"] },
    });
    expect(text(planResult)).toContain("Plan created");

    const createdPlan = await mustArtifact("Itest-created plan");
    expect(createdPlan.ownerType).toBe("user");
    expect(createdPlan.ownerId).toBe(engMember.id);

    const docResult = await client.callTool({
      name: "create_doc",
      arguments: { title: "Itest-created doc", body: "Doc body from itest" },
    });
    expect(text(docResult)).toContain("Doc created");

    const createdDoc = await mustArtifact("Itest-created doc");
    expect(createdDoc.ownerType).toBe("user");
    expect(createdDoc.ownerId).toBe(engMember.id);

    // access.itest.ts asserts an exact total artifact count against the same
    // database; vitest doesn't guarantee this file runs before that one, so
    // clean up the rows this test permanently added (FK cascade handles the
    // version/task rows underneath each).
    await db.delete(schema.artifacts).where(eq(schema.artifacts.id, createdPlan.id));
    await db.delete(schema.artifacts).where(eq(schema.artifacts.id, createdDoc.id));
  });

  it("negative: denies update_task_status on a plan outside the caller's access", async () => {
    // plan1 is owned by team backend; marketingMember (team content) has no
    // path to it — not a member, not shared, not public.
    const client = await connect({ userId: marketingMember.id, systemRole: "user" }, { write: true });
    const plan1 = await mustArtifact("Sửa lỗi phiên đăng nhập hết hạn sớm");
    const tasks = await db.query.artifactTasks.findMany({
      where: eq(schema.artifactTasks.artifactId, plan1.id),
      orderBy: schema.artifactTasks.position,
    });

    const result = await client.callTool({
      name: "update_task_status",
      arguments: { taskId: tasks[0].id, status: "done" },
    });
    expect(text(result)).toContain("Access denied");
  });

  it("set_workflow_stage_status persists, verified via a fresh get_workflow call", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const workflow = await mustWorkflow("Session bug fix process");
    const review = await mustStage(workflow.id, "Review");

    const updateResult = await client.callTool({
      name: "set_workflow_stage_status",
      arguments: { stageId: review.id, status: "doing" },
    });
    expect(text(updateResult)).toContain("Progress: 1/3 stages done");

    const workflowResult = await client.callTool({ name: "get_workflow", arguments: { id: workflow.id } });
    expect(text(workflowResult)).toContain("[~] Review");

    // Restore fixture state so other tests in this file (and other files
    // sharing the same seeded DB) see the fixture's original todo/doing/done mix.
    await db.update(schema.workflowStages).set({ status: "todo" }).where(eq(schema.workflowStages.id, review.id));
  });

  it("negative: denies set_workflow_stage_status on a workflow outside the caller's access", async () => {
    // workflow1 is owned by team backend; marketingMember (team content) has
    // no path to it, same reasoning as the update_task_status negative case above.
    const client = await connect({ userId: marketingMember.id, systemRole: "user" }, { write: true });
    const workflow = await mustWorkflow("Session bug fix process");
    const spec = await mustStage(workflow.id, "Spec");

    const result = await client.callTool({
      name: "set_workflow_stage_status",
      arguments: { stageId: spec.id, status: "todo" },
    });
    expect(text(result)).toContain("Access denied");
  });

  it("attach_artifact_to_workflow_stage attaches by slug, persists, and is idempotent", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const workflow = await mustWorkflow("Session bug fix process");
    const review = await mustStage(workflow.id, "Review");

    const first = await client.callTool({
      name: "attach_artifact_to_workflow_stage",
      arguments: { stageId: review.id, slug: skill2Slug },
    });
    expect(text(first)).toContain("Attached: [skill] Hướng dẫn viết test tự động");

    const workflowResult = await client.callTool({ name: "get_workflow", arguments: { id: workflow.id } });
    const t = text(workflowResult);
    expect(t).toContain("[skill] Hướng dẫn viết test tự động");
    expect(t).toContain(`get_skill('${skill2Slug}')`);

    const second = await client.callTool({
      name: "attach_artifact_to_workflow_stage",
      arguments: { stageId: review.id, slug: skill2Slug },
    });
    expect(text(second)).toContain("Already attached");

    // Restore fixture state (Review starts with nothing attached — asserted
    // by the "returns ordered stages" test above).
    const skill2 = await mustArtifact("Hướng dẫn viết test tự động");
    await db
      .delete(schema.workflowStageArtifacts)
      .where(
        and(
          eq(schema.workflowStageArtifacts.stageId, review.id),
          eq(schema.workflowStageArtifacts.artifactId, skill2.id),
        ),
      );
  });

  it("negative: attach_artifact_to_workflow_stage rejects a slug outside the caller's scope/access", async () => {
    // skill3 ("Debug memory leaks in Node.js") is private to marketingMember —
    // invisible to engMember's searchMeta, same as it would be to get_skill.
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const workflow = await mustWorkflow("Session bug fix process");
    const review = await mustStage(workflow.id, "Review");

    const result = await client.callTool({
      name: "attach_artifact_to_workflow_stage",
      arguments: { stageId: review.id, slug: "debug-memory-leaks-in-node-js" },
    });
    expect(text(result)).toContain("not found or not accessible");
  });

  it("negative: attach_artifact_to_workflow_stage denies a viewer who can see but not manage the workflow", async () => {
    // org-viewer's org membership covers backend team's cone (D-016) so they
    // can view the workflow, but their role is "viewer" — not editor/admin —
    // so canManageWorkflow must reject the attach.
    const client = await connect({ userId: orgViewer.id, systemRole: "user" }, { write: true });
    const workflow = await mustWorkflow("Session bug fix process");
    const review = await mustStage(workflow.id, "Review");

    const result = await client.callTool({
      name: "attach_artifact_to_workflow_stage",
      arguments: { stageId: review.id, slug: skill2Slug },
    });
    expect(text(result)).toContain("Access denied");
  });

  it("returns a friendly message (not a thrown error) for an unknown stage id", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const result = await client.callTool({
      name: "attach_artifact_to_workflow_stage",
      arguments: { stageId: "00000000-0000-0000-0000-000000000000", slug: skill2Slug },
    });
    expect(text(result)).toContain("not found");
  });
});

describe("update_doc / delete_doc (Phase 50 M0)", () => {
  it("update_doc creates a new version, reflected in a fresh get_doc call", async () => {
    // orgAdmin's org membership is an *ancestor* of doc2's owning department
    // (engineering) — canMutatePrompt walks up the chain, so this is the
    // manage-capable identity for a department-owned artifact here.
    const client = await connect({ userId: orgAdmin.id, systemRole: "user" }, { write: true });
    const doc2 = await mustArtifact("Next.js 16 migration notes");
    const doc2Slug = `${ENG_PATH}.${slugify(doc2.title)}`;

    const updateResult = await client.callTool({
      name: "update_doc",
      arguments: { slug: doc2Slug, body: "Updated notes via MCP itest." },
    });
    expect(text(updateResult)).toContain("updated");

    // Fresh connection: get_doc's docBySlug map caches version content at
    // createMcpServer() time, so re-reading on the same client that just
    // wrote the update would see stale pre-update content.
    const readClient = await connect({ userId: orgAdmin.id, systemRole: "user" }, { write: true });
    const docResult = await readClient.callTool({ name: "get_doc", arguments: { slug: doc2Slug } });
    expect(text(docResult)).toContain("Updated notes via MCP itest.");

    // Restore fixture body so other tests reading this doc aren't affected.
    await readClient.callTool({
      name: "update_doc",
      arguments: { slug: doc2Slug, body: "Notes on breaking changes encountered while upgrading from Next.js 15 to 16." },
    });
  });

  it("negative: denies update_doc for a viewer who can read but not manage (role only on a descendant team)", async () => {
    // engMember is editor on team backend, a *descendant* of doc2's owning
    // department (engineering) — effectiveGroupRole only walks upward from
    // the owning group, so this role doesn't count. engMember can still
    // read doc2 (D-016 cone includes descendants-of-ancestors), just not edit it.
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const doc2 = await mustArtifact("Next.js 16 migration notes");
    const doc2Slug = `${ENG_PATH}.${slugify(doc2.title)}`;

    const result = await client.callTool({
      name: "update_doc",
      arguments: { slug: doc2Slug, body: "Should not apply." },
    });
    expect(text(result)).toContain("Access denied");
  });

  it("negative: update_doc/delete_doc on an unknown slug returns a friendly message", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const updateResult = await client.callTool({
      name: "update_doc",
      arguments: { slug: "does-not-exist", body: "x" },
    });
    expect(text(updateResult)).toContain("not found");

    const deleteResult = await client.callTool({
      name: "delete_doc",
      arguments: { slug: "does-not-exist" },
    });
    expect(text(deleteResult)).toContain("not found");
  });

  it("delete_doc removes the artifact and records exactly one audit row", async () => {
    const createClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });

    const createResult = await createClient.callTool({
      name: "create_doc",
      arguments: { title: "Itest doc for delete_doc", body: "Throwaway." },
    });
    const createdSlug = slugify("Itest doc for delete_doc");
    expect(text(createResult)).toContain("Doc created");

    const createdDoc = await mustArtifact("Itest doc for delete_doc");
    const beforeAudit = await db
      .select()
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.action, "artifact.delete"), eq(schema.auditEvents.targetId, createdDoc.id)));
    expect(beforeAudit).toHaveLength(0);

    // Fresh connection: docBySlug is a per-connection snapshot taken at
    // createMcpServer() time, so the doc just created above isn't visible on
    // the client that created it — a new connection re-fetches from the DB.
    const deleteClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const deleteResult = await deleteClient.callTool({ name: "delete_doc", arguments: { slug: createdSlug } });
    expect(text(deleteResult)).toContain("deleted");

    const remaining = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, createdDoc.id));
    expect(remaining).toHaveLength(0);

    const afterAudit = await db
      .select()
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.action, "artifact.delete"), eq(schema.auditEvents.targetId, createdDoc.id)));
    expect(afterAudit).toHaveLength(1);
  });
});

describe("update_plan / delete_plan (Phase 50 M1)", () => {
  it("update_plan creates a new version, reflected in a fresh get_plan call, without touching tasks", async () => {
    // plan2 is owned by department engineering, same access boundary as doc2
    // above: orgAdmin (admin on the ancestor org) can manage it.
    const client = await connect({ userId: orgAdmin.id, systemRole: "user" }, { write: true });
    const plan2 = await mustArtifact("Migrate to Next.js 16");
    const taskCountBefore = (
      await db.query.artifactTasks.findMany({ where: eq(schema.artifactTasks.artifactId, plan2.id) })
    ).length;

    const updateResult = await client.callTool({
      name: "update_plan",
      arguments: { slug: plan2Slug, body: "## Overview\n\nUpdated via MCP itest." },
    });
    expect(text(updateResult)).toContain("updated");

    // Fresh connection: get_plan's planBySlug map caches version content at
    // createMcpServer() time (same reasoning as update_doc above).
    const readClient = await connect({ userId: orgAdmin.id, systemRole: "user" }, { write: true });
    const planResult = await readClient.callTool({ name: "get_plan", arguments: { slug: plan2Slug } });
    const planText = text(planResult);
    expect(planText).toContain("Updated via MCP itest.");

    const taskCountAfter = (
      await db.query.artifactTasks.findMany({ where: eq(schema.artifactTasks.artifactId, plan2.id) })
    ).length;
    expect(taskCountAfter).toBe(taskCountBefore);

    // Restore fixture body so other tests reading this plan aren't affected.
    await readClient.callTool({
      name: "update_plan",
      arguments: { slug: plan2Slug, body: "## Overview\n\nTrack the upgrade path and verification steps." },
    });
  });

  it("negative: denies update_plan for a viewer who can read but not manage (role only on a descendant team)", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const result = await client.callTool({
      name: "update_plan",
      arguments: { slug: plan2Slug, body: "Should not apply." },
    });
    expect(text(result)).toContain("Access denied");
  });

  it("negative: update_plan/delete_plan on an unknown slug returns a friendly message", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const updateResult = await client.callTool({
      name: "update_plan",
      arguments: { slug: "does-not-exist", body: "x" },
    });
    expect(text(updateResult)).toContain("not found");

    const deleteResult = await client.callTool({
      name: "delete_plan",
      arguments: { slug: "does-not-exist" },
    });
    expect(text(deleteResult)).toContain("not found");
  });

  it("delete_plan removes the artifact + its tasks and records exactly one audit row", async () => {
    const createClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });

    const createResult = await createClient.callTool({
      name: "create_plan",
      arguments: { title: "Itest plan for delete_plan", body: "Throwaway.", tasks: ["a task"] },
    });
    const createdSlug = slugify("Itest plan for delete_plan");
    expect(text(createResult)).toContain("Plan created");

    const createdPlan = await mustArtifact("Itest plan for delete_plan");
    const tasksBefore = await db.query.artifactTasks.findMany({ where: eq(schema.artifactTasks.artifactId, createdPlan.id) });
    expect(tasksBefore).toHaveLength(1);

    const deleteClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const deleteResult = await deleteClient.callTool({ name: "delete_plan", arguments: { slug: createdSlug } });
    expect(text(deleteResult)).toContain("deleted");

    const remainingArtifact = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, createdPlan.id));
    expect(remainingArtifact).toHaveLength(0);
    const remainingTasks = await db.query.artifactTasks.findMany({ where: eq(schema.artifactTasks.artifactId, createdPlan.id) });
    expect(remainingTasks).toHaveLength(0);

    const afterAudit = await db
      .select()
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.action, "artifact.delete"), eq(schema.auditEvents.targetId, createdPlan.id)));
    expect(afterAudit).toHaveLength(1);
  });
});

describe("create_skill / update_skill / delete_skill (Phase 50 M2)", () => {
  it("creates a personal skill with bundled files, retrievable via get_skill and pull_skill, then updates and deletes it", async () => {
    const createClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const createResult = await createClient.callTool({
      name: "create_skill",
      arguments: {
        title: "Itest skill with files",
        body: "# Itest skill\n\nDo the thing.",
        files: [{ path: "scripts/check.sh", content: "#!/bin/sh\necho ok" }],
      },
    });
    expect(text(createResult)).toContain("Skill created");
    expect(text(createResult)).toContain("Files attached: 1");
    const createdSlug = slugify("Itest skill with files");
    const createdSkill = await mustArtifact("Itest skill with files");

    // Fresh connection: skillBySlug is a per-connection snapshot taken at
    // createMcpServer() time (same reasoning as update_doc/update_plan above).
    const readClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const getText = text(await readClient.callTool({ name: "get_skill", arguments: { slug: createdSlug } }));
    expect(getText).toContain("Do the thing.");
    expect(getText).toContain("scripts/check.sh");
    expect(getText).toContain("echo ok");

    const bundle = JSON.parse(text(await readClient.callTool({ name: "pull_skill", arguments: { slug: createdSlug } })));
    expect(bundle.files).toEqual([expect.objectContaining({ path: "scripts/check.sh", content: "#!/bin/sh\necho ok" })]);

    const updateResult = await readClient.callTool({
      name: "update_skill",
      arguments: {
        slug: createdSlug,
        body: "# Itest skill\n\nDo the updated thing.",
        files: [{ path: "scripts/other.sh", content: "#!/bin/sh\necho updated" }],
      },
    });
    expect(text(updateResult)).toContain("updated");

    const updateReadClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const bundleAfterUpdate = JSON.parse(
      text(await updateReadClient.callTool({ name: "pull_skill", arguments: { slug: createdSlug } })),
    );
    expect(bundleAfterUpdate.body).toContain("Do the updated thing.");
    // Files are replaced wholesale, not merged — the old file is gone.
    expect(bundleAfterUpdate.files).toEqual([
      expect.objectContaining({ path: "scripts/other.sh", content: "#!/bin/sh\necho updated" }),
    ]);

    const deleteResult = await updateReadClient.callTool({ name: "delete_skill", arguments: { slug: createdSlug } });
    expect(text(deleteResult)).toContain("deleted");
    const remaining = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, createdSkill.id));
    expect(remaining).toHaveLength(0);
  });

  it("rejects an absolute path and a directory-escaping path in create_skill's files, writing nothing", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });

    const absoluteResult = await client.callTool({
      name: "create_skill",
      arguments: {
        title: "Itest skill absolute path",
        body: "body",
        files: [{ path: "/etc/passwd", content: "x" }],
      },
    });
    expect(text(absoluteResult)).toContain("Refusing to write absolute path");

    const escapeResult = await client.callTool({
      name: "create_skill",
      arguments: {
        title: "Itest skill escaping path",
        body: "body",
        files: [{ path: "../../etc/passwd", content: "x" }],
      },
    });
    expect(text(escapeResult)).toContain("Refusing to write path that escapes its directory");

    const absoluteRow = await db.select().from(schema.artifacts).where(eq(schema.artifacts.title, "Itest skill absolute path"));
    expect(absoluteRow).toHaveLength(0);
    const escapeRow = await db.select().from(schema.artifacts).where(eq(schema.artifacts.title, "Itest skill escaping path"));
    expect(escapeRow).toHaveLength(0);
  });

  it("rejects a directory-escaping path in update_skill's files without creating a new version", async () => {
    // orgAdmin's org membership is an ancestor of skill2's owning department
    // (engineering) — same manage-capable identity as update_doc/update_plan above.
    const client = await connect({ userId: orgAdmin.id, systemRole: "user" }, { write: true });
    const skill2 = await mustArtifact("Hướng dẫn viết test tự động");
    const versionCountBefore = (
      await db.query.artifactVersions.findMany({ where: eq(schema.artifactVersions.artifactId, skill2.id) })
    ).length;

    const result = await client.callTool({
      name: "update_skill",
      arguments: { slug: skill2Slug, body: "Should not apply.", files: [{ path: "..", content: "x" }] },
    });
    expect(text(result)).toContain("Refusing to write path that escapes its directory");

    const versionCountAfter = (
      await db.query.artifactVersions.findMany({ where: eq(schema.artifactVersions.artifactId, skill2.id) })
    ).length;
    expect(versionCountAfter).toBe(versionCountBefore);
  });

  it("negative: denies update_skill/delete_skill for a viewer who can read but not manage (role only on a descendant team)", async () => {
    // skill2 is owned by department engineering, same access boundary as
    // doc2/plan2 above: engMember's editor role on descendant team backend
    // doesn't count (effectiveGroupRole only walks upward from the owning group).
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });

    const updateResult = await client.callTool({
      name: "update_skill",
      arguments: { slug: skill2Slug, body: "Should not apply." },
    });
    expect(text(updateResult)).toContain("Access denied");

    const deleteResult = await client.callTool({ name: "delete_skill", arguments: { slug: skill2Slug } });
    expect(text(deleteResult)).toContain("Access denied");
  });

  it("negative: create_skill in a group space denies a user with no role on that group or its ancestors", async () => {
    const [engDept] = await db.select().from(schema.departments).where(eq(schema.departments.slug, "engineering"));
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });

    const result = await client.callTool({
      name: "create_skill",
      arguments: {
        title: "Itest skill denied group create",
        body: "body",
        ownerType: "department",
        ownerId: engDept.id,
      },
    });
    expect(text(result)).toContain("Permission denied");

    const row = await db.select().from(schema.artifacts).where(eq(schema.artifacts.title, "Itest skill denied group create"));
    expect(row).toHaveLength(0);
  });

  it("negative: update_skill/delete_skill on an unknown slug returns a friendly message", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const updateResult = await client.callTool({
      name: "update_skill",
      arguments: { slug: "does-not-exist", body: "x" },
    });
    expect(text(updateResult)).toContain("not found");

    const deleteResult = await client.callTool({
      name: "delete_skill",
      arguments: { slug: "does-not-exist" },
    });
    expect(text(deleteResult)).toContain("not found");
  });
});

describe("get_prompt / create_prompt / update_prompt / delete_prompt (Phase 51 M0)", () => {
  it("creates a personal prompt with a {{variable}}, retrievable via get_prompt, then re-syncs variables on update and deletes it", async () => {
    const createClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const createResult = await createClient.callTool({
      name: "create_prompt",
      arguments: {
        title: "Itest prompt with variable",
        body: "Summarize {{topic}} for a general audience.",
      },
    });
    expect(text(createResult)).toContain("Prompt created");
    const createdSlug = slugify("Itest prompt with variable");
    const createdPrompt = await mustArtifact("Itest prompt with variable");

    // Fresh connection: promptBySlug is a per-connection snapshot taken at
    // createMcpServer() time (same reasoning as update_doc/update_skill above).
    const readClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const getText = text(await readClient.callTool({ name: "get_prompt", arguments: { slug: createdSlug } }));
    expect(getText).toContain("Summarize {{topic}} for a general audience.");
    expect(getText).toContain("Variables: {{topic}}");

    const updateResult = await readClient.callTool({
      name: "update_prompt",
      arguments: { slug: createdSlug, body: "Summarize {{topic}} in a {{tone}} tone." },
    });
    expect(text(updateResult)).toContain("updated");

    const updateReadClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const getAfterUpdate = text(
      await updateReadClient.callTool({ name: "get_prompt", arguments: { slug: createdSlug } }),
    );
    expect(getAfterUpdate).toContain("Summarize {{topic}} in a {{tone}} tone.");
    expect(getAfterUpdate).toContain("{{topic}}");
    expect(getAfterUpdate).toContain("{{tone}}");

    // Drop {{topic}} entirely — variable sync must remove it, not just add.
    const dropResult = await updateReadClient.callTool({
      name: "update_prompt",
      arguments: { slug: createdSlug, body: "Keep it {{tone}}." },
    });
    expect(text(dropResult)).toContain("updated");

    const dropReadClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const getAfterDrop = text(
      await dropReadClient.callTool({ name: "get_prompt", arguments: { slug: createdSlug } }),
    );
    expect(getAfterDrop).toContain("Variables: {{tone}}");
    expect(getAfterDrop).not.toContain("{{topic}}");

    const deleteResult = await dropReadClient.callTool({ name: "delete_prompt", arguments: { slug: createdSlug } });
    expect(text(deleteResult)).toContain("deleted");
    const remaining = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, createdPrompt.id));
    expect(remaining).toHaveLength(0);
  });

  it("negative: denies update_prompt/delete_prompt for a viewer who can read but not manage (role only on a descendant team)", async () => {
    // Create a department-owned prompt as orgAdmin (admin on the ancestor
    // org qa-org — same manage-capable identity as doc2/plan2/skill2 above),
    // then confirm engMember's editor role on descendant team backend
    // doesn't count for it (effectiveGroupRole only walks upward).
    const [engDept] = await db.select().from(schema.departments).where(eq(schema.departments.slug, "engineering"));
    const adminClient = await connect({ userId: orgAdmin.id, systemRole: "user" }, { write: true });
    const createResult = await adminClient.callTool({
      name: "create_prompt",
      arguments: { title: "Itest dept prompt", body: "Draft a {{summary}}.", ownerType: "department", ownerId: engDept.id },
    });
    expect(text(createResult)).toContain("Prompt created");
    const createdSlug = slugify("Itest dept prompt");
    const createdPrompt = await mustArtifact("Itest dept prompt");

    const memberClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const updateResult = await memberClient.callTool({
      name: "update_prompt",
      arguments: { slug: createdSlug, body: "Should not apply." },
    });
    expect(text(updateResult)).toContain("Access denied");

    const deleteResult = await memberClient.callTool({ name: "delete_prompt", arguments: { slug: createdSlug } });
    expect(text(deleteResult)).toContain("Access denied");

    // Clean up with the identity that can actually manage it.
    const adminReadClient = await connect({ userId: orgAdmin.id, systemRole: "user" }, { write: true });
    await adminReadClient.callTool({ name: "delete_prompt", arguments: { slug: createdSlug } });
    const remaining = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, createdPrompt.id));
    expect(remaining).toHaveLength(0);
  });

  it("negative: create_prompt in a group space denies a user with no role on that group or its ancestors", async () => {
    const [engDept] = await db.select().from(schema.departments).where(eq(schema.departments.slug, "engineering"));
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });

    const result = await client.callTool({
      name: "create_prompt",
      arguments: { title: "Itest prompt denied group create", body: "body", ownerType: "department", ownerId: engDept.id },
    });
    expect(text(result)).toContain("Permission denied");

    const row = await db.select().from(schema.artifacts).where(eq(schema.artifacts.title, "Itest prompt denied group create"));
    expect(row).toHaveLength(0);
  });

  it("negative: get_prompt/update_prompt/delete_prompt on an unknown slug return a friendly message", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });

    const getResult = await client.callTool({ name: "get_prompt", arguments: { slug: "does-not-exist" } });
    expect(text(getResult)).toContain("not found");

    const updateResult = await client.callTool({
      name: "update_prompt",
      arguments: { slug: "does-not-exist", body: "x" },
    });
    expect(text(updateResult)).toContain("not found");

    const deleteResult = await client.callTool({
      name: "delete_prompt",
      arguments: { slug: "does-not-exist" },
    });
    expect(text(deleteResult)).toContain("not found");
  });

  it("delete_prompt removes the artifact and records exactly one audit row", async () => {
    const createClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const createResult = await createClient.callTool({
      name: "create_prompt",
      arguments: { title: "Itest prompt for delete_prompt", body: "Throwaway." },
    });
    const createdSlug = slugify("Itest prompt for delete_prompt");
    expect(text(createResult)).toContain("Prompt created");
    const createdPrompt = await mustArtifact("Itest prompt for delete_prompt");

    const beforeAudit = await db
      .select()
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.action, "artifact.delete"), eq(schema.auditEvents.targetId, createdPrompt.id)));
    expect(beforeAudit).toHaveLength(0);

    const deleteClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const deleteResult = await deleteClient.callTool({ name: "delete_prompt", arguments: { slug: createdSlug } });
    expect(text(deleteResult)).toContain("deleted");

    const remaining = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, createdPrompt.id));
    expect(remaining).toHaveLength(0);

    const afterAudit = await db
      .select()
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.action, "artifact.delete"), eq(schema.auditEvents.targetId, createdPrompt.id)));
    expect(afterAudit).toHaveLength(1);
  });
});

describe("slug rename via update_* tools (newSlug)", () => {
  it("update_skill renames the slug; the new slug resolves and the old one no longer does", async () => {
    const createClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    await createClient.callTool({
      name: "create_skill",
      arguments: { title: "Itest skill rename source", body: "# body" },
    });
    const oldSlug = slugify("Itest skill rename source");
    const createdSkill = await mustArtifact("Itest skill rename source");

    const renameClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const renameResult = await renameClient.callTool({
      name: "update_skill",
      arguments: { slug: oldSlug, newSlug: "itest-renamed" },
    });
    expect(text(renameResult)).toContain("slug is now 'itest-renamed'");

    const [row] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, createdSkill.id));
    expect(row.slug).toBe("itest-renamed");

    // Fresh connection: skillBySlug is a per-connection snapshot, so it now
    // indexes the new slug and no longer the old one.
    const readClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    expect(text(await readClient.callTool({ name: "get_skill", arguments: { slug: "itest-renamed" } }))).toContain("body");
    expect(text(await readClient.callTool({ name: "get_skill", arguments: { slug: oldSlug } }))).toContain("not found");

    await readClient.callTool({ name: "delete_skill", arguments: { slug: "itest-renamed" } });
  });

  it("update_prompt rejects a newSlug already taken by another artifact in the same space, leaving the slug unchanged", async () => {
    // MCP-created artifacts start with a NULL stored slug (their display slug
    // is derived from the title), so a collision only exists once an artifact
    // has been given a concrete stored slug — same semantics as the DB's
    // partial-unique index and the router's checkSlug. So rename A to a fixed
    // slug first, then confirm B can't take it.
    const createClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    await createClient.callTool({ name: "create_prompt", arguments: { title: "Itest prompt slug A", body: "a" } });
    await createClient.callTool({ name: "create_prompt", arguments: { title: "Itest prompt slug B", body: "b" } });
    const slugB = slugify("Itest prompt slug B");
    const promptB = await mustArtifact("Itest prompt slug B");

    const renameAClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    await renameAClient.callTool({
      name: "update_prompt",
      arguments: { slug: slugify("Itest prompt slug A"), newSlug: "itest-taken-slug" },
    });

    const renameBClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const result = await renameBClient.callTool({
      name: "update_prompt",
      arguments: { slug: slugB, newSlug: "itest-taken-slug" },
    });
    expect(text(result)).toContain("already taken");

    const [row] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, promptB.id));
    expect(row.slug).toBeNull(); // unchanged — B never got a stored slug

    const cleanupClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    await cleanupClient.callTool({ name: "delete_prompt", arguments: { slug: "itest-taken-slug" } });
    await cleanupClient.callTool({ name: "delete_prompt", arguments: { slug: slugB } });
  });

  it("update_doc rejects a malformed newSlug at the input-validation layer", async () => {
    const createClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    await createClient.callTool({ name: "create_doc", arguments: { title: "Itest doc bad slug", body: "x" } });
    const docSlug = slugify("Itest doc bad slug");

    const renameClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const result = await renameClient.callTool({
      name: "update_doc",
      arguments: { slug: docSlug, newSlug: "Not Valid Slug!" },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("validation error");

    const cleanupClient = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    await cleanupClient.callTool({ name: "delete_doc", arguments: { slug: docSlug } });
  });
});
