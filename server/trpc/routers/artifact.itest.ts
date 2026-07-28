import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createTestDb } from "@/server/test-support/test-db";
import * as schema from "@/server/db/schema";
import { createArtifact } from "@/server/services/artifact";
import { artifactRouter, type ArtifactBundleV2 } from "./artifact";
import type { Context } from "@/server/trpc/context";

const { db, close } = createTestDb();

type Identity = { userId: string; systemRole: "user" | "superadmin" };

function callerAs(identity: Identity) {
  const ctx: Context = { db, session: identity };
  return artifactRouter.createCaller(ctx);
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

let engMember: typeof schema.users.$inferSelect;
let outsider: typeof schema.users.$inferSelect;
let content: typeof schema.teams.$inferSelect;

// This file's tests create real, permanent artifacts (createArtifact,
// duplicate, import all write rows, not just read). access.itest.ts asserts
// exact artifact counts against the same database, and vitest doesn't
// guarantee this file runs before that one — track every id created here and
// delete them in afterAll (FK cascade handles the version/member/task/file
// rows underneath each), same fix as server.itest.ts's Phase 36 M4.1 finding.
const createdArtifactIds: string[] = [];

beforeAll(async () => {
  engMember = await mustUser("eng-member@test.local");
  outsider = await mustUser("outsider@test.local");
  [content] = await db.select().from(schema.teams).where(eq(schema.teams.slug, "content"));
});

afterAll(async () => {
  if (createdArtifactIds.length > 0) {
    await db.delete(schema.artifacts).where(inArray(schema.artifacts.id, createdArtifactIds));
  }
  await close();
});

describe("createArtifact (server/services/artifact.ts)", () => {
  it("creates a bare prompt with a v1 version and currentVersionId set", async () => {
    const created = await createArtifact(
      {
        kind: "prompt",
        ownerType: "user",
        ownerId: engMember.id,
        title: "itest bare prompt",
        body: "hello {{name}}",
        createdBy: engMember.id,
      },
      db,
    );
    createdArtifactIds.push(created.id);
    expect(created.kind).toBe("prompt");
    expect(created.currentVersionId).toBeTruthy();

    const version = await db.query.artifactVersions.findFirst({
      where: eq(schema.artifactVersions.id, created.currentVersionId!),
    });
    expect(version?.body).toBe("hello {{name}}");
    expect(version?.versionNo).toBe(1);
  });

  it("creates a skill with bundled files", async () => {
    const created = await createArtifact(
      {
        kind: "skill",
        ownerType: "user",
        ownerId: engMember.id,
        title: "itest skill with files",
        body: "# instructions",
        createdBy: engMember.id,
        files: [{ path: "notes.md", content: "some notes", mimeType: "text/markdown" }],
      },
      db,
    );
    createdArtifactIds.push(created.id);
    const files = await db.query.artifactFiles.findMany({
      where: eq(schema.artifactFiles.artifactVersionId, created.currentVersionId!),
    });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: "notes.md", content: "some notes" });
  });

  it("creates a plan with tasks", async () => {
    const created = await createArtifact(
      {
        kind: "plan",
        ownerType: "user",
        ownerId: engMember.id,
        title: "itest plan with tasks",
        body: "overview",
        createdBy: engMember.id,
        tasks: [{ content: "first" }, { content: "second", status: "done" }],
      },
      db,
    );
    createdArtifactIds.push(created.id);
    const tasks = await db.query.artifactTasks.findMany({
      where: eq(schema.artifactTasks.artifactId, created.id),
      orderBy: schema.artifactTasks.position,
    });
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ content: "first", status: "todo", position: 0 });
    expect(tasks[1]).toMatchObject({ content: "second", status: "done", position: 1 });
  });
});

describe("artifact.duplicate", () => {
  it("duplicates a personal prompt into the caller's own space as private, title suffixed", async () => {
    const source = await mustArtifact("Summarize meeting notes");
    const caller = callerAs({ userId: engMember.id, systemRole: "user" });
    const copy = await caller.duplicate({ sourceId: source.id });
    createdArtifactIds.push(copy.id);

    expect(copy.title).toBe("Summarize meeting notes (copy)");
    expect(copy.ownerType).toBe("user");
    expect(copy.ownerId).toBe(engMember.id);
    expect(copy.visibility).toBe("private");

    const version = await db.query.artifactVersions.findFirst({
      where: eq(schema.artifactVersions.id, copy.currentVersionId!),
    });
    expect(version?.body).toContain("Summarize the following transcript");
  });

  it("duplicates a skill, preserving its bundled files", async () => {
    const source = await mustArtifact("PR review checklist");
    const caller = callerAs({ userId: engMember.id, systemRole: "user" });
    const copy = await caller.duplicate({ sourceId: source.id });
    createdArtifactIds.push(copy.id);

    const files = await db.query.artifactFiles.findMany({
      where: eq(schema.artifactFiles.artifactVersionId, copy.currentVersionId!),
    });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: "checklist.md" });
    expect(files[0].content).toContain("Tests pass");
  });

  it("denies duplicating a source the caller cannot access", async () => {
    const source = await mustArtifact("Summarize meeting notes"); // private to eng-member
    const caller = callerAs({ userId: outsider.id, systemRole: "user" });
    await expect(caller.duplicate({ sourceId: source.id })).rejects.toThrow(/FORBIDDEN|NOT_FOUND/);
  });

  it("denies duplicating into a group space the caller has no editor/admin role in", async () => {
    const source = await mustArtifact("Summarize meeting notes");
    const caller = callerAs({ userId: engMember.id, systemRole: "user" }); // not a member of team content
    await expect(
      caller.duplicate({ sourceId: source.id, ownerType: "team", ownerId: content.id }),
    ).rejects.toThrow(/editor or admin/);
  });
});

describe("artifact.export", () => {
  it("exports a plain prompt as a v2 bundle", async () => {
    const source = await mustArtifact("Summarize meeting notes");
    const caller = callerAs({ userId: engMember.id, systemRole: "user" });
    const bundle = await caller.export({ id: source.id });

    expect(bundle.schemaVersion).toBe(2);
    expect(bundle.kind).toBe("prompt");
    expect(bundle.title).toBe("Summarize meeting notes");
    expect(bundle.tags).toEqual(["productivity"]);
    expect(bundle.files).toEqual([]);
    expect(bundle.tasks).toEqual([]);
  });

  it("exports a skill's bundled files", async () => {
    const source = await mustArtifact("PR review checklist");
    const caller = callerAs({ userId: engMember.id, systemRole: "user" });
    const bundle = await caller.export({ id: source.id });

    expect(bundle.files).toHaveLength(1);
    expect(bundle.files[0].path).toBe("checklist.md");
    expect(bundle.files[0].content).toContain("Tests pass");
  });

  it("exports a plan's tasks in position order", async () => {
    const source = await mustArtifact("Sửa lỗi phiên đăng nhập hết hạn sớm"); // done, doing, todo
    const caller = callerAs({ userId: engMember.id, systemRole: "user" });
    const bundle = await caller.export({ id: source.id });

    expect(bundle.tasks).toHaveLength(3);
    expect(bundle.tasks.map((t) => t.status)).toEqual(["done", "doing", "todo"]);
  });

  it("denies exporting a source the caller cannot access", async () => {
    const source = await mustArtifact("Summarize meeting notes");
    const caller = callerAs({ userId: outsider.id, systemRole: "user" });
    await expect(caller.export({ id: source.id })).rejects.toThrow(/FORBIDDEN|NOT_FOUND/);
  });
});

describe("artifact.import", () => {
  function bundle(overrides: Partial<ArtifactBundleV2> = {}): ArtifactBundleV2 {
    return {
      schemaVersion: 2,
      kind: "prompt",
      title: "itest imported prompt",
      slug: null,
      description: "an imported bundle",
      tags: ["imported"],
      body: "imported body {{x}}",
      files: [],
      tasks: [],
      ...overrides,
    };
  }

  it("creates a new artifact in the caller's personal space, private", async () => {
    const caller = callerAs({ userId: engMember.id, systemRole: "user" });
    const result = await caller.import({ bundle: bundle() });
    createdArtifactIds.push(result.id);

    expect(result.title).toBe("itest imported prompt");
    expect(result.ownerType).toBe("user");
    expect(result.ownerId).toBe(engMember.id);
    expect(result.visibility).toBe("private");

    const version = await db.query.artifactVersions.findFirst({
      where: eq(schema.artifactVersions.id, result.currentVersionId!),
    });
    expect(version?.body).toBe("imported body {{x}}");
  });

  it("accepts a legacy v1 non-Kit bundle", async () => {
    const caller = callerAs({ userId: engMember.id, systemRole: "user" });
    const result = await caller.import({
      bundle: {
        schemaVersion: 1,
        kind: "prompt",
        title: "itest imported legacy prompt",
        tags: [],
        body: "legacy body",
        files: [],
        members: [],
        tasks: [],
      },
    });
    createdArtifactIds.push(result.id);
    expect(result.kind).toBe("prompt");
  });

  it("rejects a legacy v1 Kit bundle before writing", async () => {
    const caller = callerAs({ userId: engMember.id, systemRole: "user" });
    await expect(
      caller.import({
        bundle: {
          schemaVersion: 1,
          kind: "kit",
          title: "legacy kit",
          tags: [],
          body: "legacy",
          files: [],
          members: [],
          tasks: [],
        },
      }),
    ).rejects.toThrow(/Kit bundles are no longer supported/);
    const rows = await db.query.artifacts.findMany({
      where: eq(schema.artifacts.title, "legacy kit"),
    });
    expect(rows).toHaveLength(0);
  });

  it("denies importing into a group space the caller has no editor/admin role in", async () => {
    const caller = callerAs({ userId: engMember.id, systemRole: "user" });
    await expect(
      caller.import({ bundle: bundle(), ownerType: "team", ownerId: content.id }),
    ).rejects.toThrow(/editor or admin/);
  });

  it("round-trips export -> import with content intact", async () => {
    const source = await mustArtifact("Viết email xin nghỉ phép"); // public org prompt
    const caller = callerAs({ userId: engMember.id, systemRole: "user" });

    const exported = await caller.export({ id: source.id });
    const imported = await caller.import({ bundle: exported });
    createdArtifactIds.push(imported.id);

    expect(imported.title).toBe(source.title);
    expect(imported.tags).toEqual(source.tags);
    const version = await db.query.artifactVersions.findFirst({
      where: eq(schema.artifactVersions.id, imported.currentVersionId!),
    });
    expect(version?.body).toBe(exported.body);
  });
});

describe("artifact.bulkDelete (Phase 45 B2)", () => {
  it("deletes every id the caller can mutate", async () => {
    const a = await createArtifact(
      { kind: "prompt", ownerType: "user", ownerId: engMember.id, title: "bulk-delete a", body: "x", createdBy: engMember.id },
      db,
    );
    const b = await createArtifact(
      { kind: "prompt", ownerType: "user", ownerId: engMember.id, title: "bulk-delete b", body: "x", createdBy: engMember.id },
      db,
    );

    const caller = callerAs({ userId: engMember.id, systemRole: "user" });
    const result = await caller.bulkDelete({ ids: [a.id, b.id] });

    expect(result.deletedIds.sort()).toEqual([a.id, b.id].sort());
    expect(result.skippedIds).toEqual([]);
    const remaining = await db.query.artifacts.findMany({ where: inArray(schema.artifacts.id, [a.id, b.id]) });
    expect(remaining).toHaveLength(0);
  });

  it("skips an id the caller cannot mutate, deletes the rest, and leaves the skipped artifact intact", async () => {
    const own = await createArtifact(
      { kind: "prompt", ownerType: "user", ownerId: engMember.id, title: "bulk-delete own", body: "x", createdBy: engMember.id },
      db,
    );
    const notMine = await mustArtifact("Viết email xin nghỉ phép"); // org-owned public prompt — readable but not mutable by engMember

    const caller = callerAs({ userId: engMember.id, systemRole: "user" });
    const result = await caller.bulkDelete({ ids: [own.id, notMine.id] });

    expect(result.deletedIds).toEqual([own.id]);
    expect(result.skippedIds).toEqual([notMine.id]);
    const stillThere = await db.query.artifacts.findFirst({ where: eq(schema.artifacts.id, notMine.id) });
    expect(stillThere).toBeDefined();
  });

  it("skips a non-existent id", async () => {
    const missingId = "00000000-0000-0000-0000-000000000000";
    const caller = callerAs({ userId: engMember.id, systemRole: "user" });
    const result = await caller.bulkDelete({ ids: [missingId] });
    expect(result.skippedIds).toEqual([missingId]);
    expect(result.deletedIds).toEqual([]);
  });
});

describe("artifact.bulkAddTag (Phase 45 B2)", () => {
  it("adds the tag to every mutable id, without duplicating an already-present tag", async () => {
    const a = await createArtifact(
      { kind: "prompt", ownerType: "user", ownerId: engMember.id, title: "bulk-tag a", body: "x", tags: [], createdBy: engMember.id },
      db,
    );
    const b = await createArtifact(
      { kind: "prompt", ownerType: "user", ownerId: engMember.id, title: "bulk-tag b", body: "x", tags: ["urgent"], createdBy: engMember.id },
      db,
    );
    createdArtifactIds.push(a.id, b.id);

    const caller = callerAs({ userId: engMember.id, systemRole: "user" });
    const result = await caller.bulkAddTag({ ids: [a.id, b.id], tag: "urgent" });

    expect(result.updatedIds.sort()).toEqual([a.id, b.id].sort());
    expect(result.skippedIds).toEqual([]);

    const [rowA] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, a.id));
    const [rowB] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, b.id));
    expect(rowA.tags).toEqual(["urgent"]);
    expect(rowB.tags).toEqual(["urgent"]); // no duplicate
  });

  it("skips an id the caller cannot mutate, leaving its tags unchanged", async () => {
    const own = await createArtifact(
      { kind: "prompt", ownerType: "user", ownerId: engMember.id, title: "bulk-tag own", body: "x", createdBy: engMember.id },
      db,
    );
    createdArtifactIds.push(own.id);
    const notMine = await mustArtifact("Viết email xin nghỉ phép");
    const tagsBefore = notMine.tags;

    const caller = callerAs({ userId: engMember.id, systemRole: "user" });
    const result = await caller.bulkAddTag({ ids: [own.id, notMine.id], tag: "should-not-apply" });

    expect(result.updatedIds).toEqual([own.id]);
    expect(result.skippedIds).toEqual([notMine.id]);
    const [after] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, notMine.id));
    expect(after.tags).toEqual(tagsBefore);
  });
});
