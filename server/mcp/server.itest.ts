import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTestDb } from "@/server/test-support/test-db";
import * as schema from "@/server/db/schema";
import { slugify } from "@/lib/slug";
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

const ORG_PATH = "qa-org";
const ENG_PATH = "qa-org.engineering";
const BACKEND_PATH = "qa-org.engineering.backend";

let engMember: typeof schema.users.$inferSelect;
let marketingMember: typeof schema.users.$inferSelect;
let outsider: typeof schema.users.$inferSelect;
let orgAdmin: typeof schema.users.$inferSelect;
let backend: typeof schema.teams.$inferSelect;

let prompt1Slug: string;
let prompt2Slug: string;
let prompt3Slug: string;
let skill1Slug: string;
let skill2Slug: string;
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
  [backend] = await db.select().from(schema.teams).where(eq(schema.teams.slug, "backend"));

  const prompt1 = await mustArtifact("Rà soát bảo mật mã nguồn");
  const prompt2 = await mustArtifact("Summarize meeting notes");
  const prompt3 = await mustArtifact("Viết email xin nghỉ phép");
  const skill1 = await mustArtifact("PR review checklist");
  const skill2 = await mustArtifact("Hướng dẫn viết test tự động");
  const kit3 = await mustArtifact("Meta kit");
  const plan1 = await mustArtifact("Sửa lỗi phiên đăng nhập hết hạn sớm");
  const plan2 = await mustArtifact("Migrate to Next.js 16");
  const doc1 = await mustArtifact("Lỗi: phiên đăng nhập hết hạn sau 5 phút");

  prompt1Slug = `${BACKEND_PATH}.${prompt1.slug}`;
  prompt2Slug = `${prompt2.slug}`;
  prompt3Slug = `${ORG_PATH}.${prompt3.slug}`;
  skill1Slug = `${BACKEND_PATH}.${slugify(skill1.title)}`;
  skill2Slug = `${ENG_PATH}.${slugify(skill2.title)}`;
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
  it("read-only scope exposes exactly the 9 read tools", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, {});
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "get_doc",
        "get_kit",
        "get_plan",
        "get_skill",
        "list_docs",
        "list_kits",
        "list_plans",
        "list_skills",
        "search_artifacts",
      ].sort(),
    );
  });

  it("write:true scope adds the 6 write tools (15 total)", async () => {
    const client = await connect({ userId: engMember.id, systemRole: "user" }, { write: true });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(15);
    const names = new Set(tools.map((t) => t.name));
    for (const n of [
      "update_task_status",
      "add_plan_task",
      "update_plan_task",
      "delete_plan_task",
      "create_plan",
      "create_doc",
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
});
