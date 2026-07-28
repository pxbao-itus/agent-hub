import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { createTestDb } from "@/server/test-support/test-db";
import { createArtifact } from "@/server/services/artifact";
import {
  createComment,
  deleteComment,
  findCollaborationArtifact,
  listComments,
  updateComment,
} from "@/server/services/comment";
import {
  ensureAssignmentSubscription,
  getSubscription,
  setSubscription,
} from "@/server/services/subscription";
import { backfillMissingUsernames } from "@/server/lib/username";
import { listArtifactActivity } from "@/server/services/artifact-activity";
import { commentRouter } from "@/server/trpc/routers/comment";
import type { Context } from "@/server/trpc/context";

const { db, close } = createTestDb();
const createdArtifactIds: string[] = [];
const createdUserIds: string[] = [];

let owner: typeof schema.users.$inferSelect;
let viewer: typeof schema.users.$inferSelect;
let outsider: typeof schema.users.$inferSelect;

beforeAll(async () => {
  owner = (await db.query.users.findFirst({ where: eq(schema.users.email, "eng-member@test.local") }))!;
  viewer = (await db.query.users.findFirst({ where: eq(schema.users.email, "marketing-member@test.local") }))!;
  outsider = (await db.query.users.findFirst({ where: eq(schema.users.email, "outsider@test.local") }))!;
});

afterAll(async () => {
  if (createdArtifactIds.length) {
    await db.delete(schema.auditEvents).where(inArray(schema.auditEvents.targetId, createdArtifactIds));
    await db.delete(schema.artifacts).where(inArray(schema.artifacts.id, createdArtifactIds));
  }
  if (createdUserIds.length) {
    await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
  }
  await close();
});

async function makeArtifact(kind: schema.ArtifactKind = "doc") {
  const artifact = await createArtifact(
    {
      kind,
      ownerType: "user",
      ownerId: owner.id,
      title: `Comment test ${kind} ${Math.random().toString(36).slice(2)}`,
      body: "body",
      createdBy: owner.id,
    },
    db,
  );
  createdArtifactIds.push(artifact.id);
  if (kind === "doc" || kind === "plan") {
    await db.insert(schema.artifactShares).values({
      artifactId: artifact.id,
      userId: viewer.id,
      role: "viewer",
      grantedBy: owner.id,
    });
  }
  return artifact;
}

const actor = (user: typeof schema.users.$inferSelect) => ({
  userId: user.id,
  systemRole: user.systemRole,
});

describe("comment service foundation", () => {
  it("suggests accessible users immediately for an empty mention query", async () => {
    const row = await makeArtifact("doc");
    const ctx: Context = { db, session: actor(viewer) };
    const candidates = await commentRouter.createCaller(ctx).searchMentionCandidates({
      artifactId: row.id,
      query: "",
      limit: 10,
    });
    const usernames = candidates.map((candidate) => candidate.username);
    expect(usernames).toContain(owner.username);
    expect(usernames).toContain(viewer.username);
    expect(usernames).not.toContain(outsider.username);
  });

  it("lets a viewer comment and resolves only accessible @username mentions", async () => {
    const row = await makeArtifact("doc");
    const artifact = await findCollaborationArtifact(row.id, db);
    const result = await createComment(
      artifact,
      { body: `Handoff to @${owner.username} and @missinguser` },
      actor(viewer),
      "ui",
      db,
    );

    expect(result.usernames).toEqual([owner.username]);
    expect(result.unresolvedMentions).toEqual(["missinguser"]);
    const mentions = await db
      .select()
      .from(schema.artifactCommentMentions)
      .where(eq(schema.artifactCommentMentions.commentId, result.comment.id));
    expect(mentions.map((mention) => mention.userId)).toEqual([owner.id]);

    const listed = await listComments(artifact, actor(viewer), { limit: 10 }, db);
    expect(listed.items[0]).toMatchObject({ id: result.comment.id, body: expect.stringContaining("@") });
  });

  it("denies an inaccessible user and rejects unsupported artifact kinds", async () => {
    const doc = await findCollaborationArtifact((await makeArtifact("doc")).id, db);
    await expect(
      createComment(doc, { body: "No access" }, actor(outsider), "ui", db),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const prompt = await makeArtifact("prompt");
    await expect(findCollaborationArtifact(prompt.id, db)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("allows author edit, denies manager edit, and allows manager tombstone moderation", async () => {
    const artifact = await findCollaborationArtifact((await makeArtifact("plan")).id, db);
    const created = await createComment(artifact, { body: "Initial" }, actor(viewer), "ui", db);
    const updated = await updateComment(created.comment.id, { body: "Updated" }, actor(viewer), db);
    expect(updated.changed).toBe(true);

    await expect(
      updateComment(created.comment.id, { body: "Manager rewrite" }, actor(owner), db),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await deleteComment(created.comment.id, actor(owner), db)).toEqual({ deleted: true });
    const tombstone = await db.query.artifactComments.findFirst({
      where: eq(schema.artifactComments.id, created.comment.id),
    });
    expect(tombstone).toMatchObject({ body: null });
    expect(tombstone?.deletedAt).toBeInstanceOf(Date);

    const audit = await db.query.auditEvents.findFirst({
      where: and(
        eq(schema.auditEvents.targetId, artifact.id),
        eq(schema.auditEvents.action, "comment.moderate.delete"),
      ),
    });
    expect(audit).toBeTruthy();
  });

  it("keeps an explicit muted preference when assignment auto-follow runs", async () => {
    const artifact = await findCollaborationArtifact((await makeArtifact("doc")).id, db);
    await setSubscription(artifact, "muted", actor(viewer), db);
    await ensureAssignmentSubscription(artifact.id, viewer.id, db);
    expect(await getSubscription(viewer.id, artifact.id, db)).toMatchObject({ mode: "muted" });
  });

  it("deduplicates mention/follow notifications and respects mentions-only/muted", async () => {
    const artifact = await findCollaborationArtifact((await makeArtifact("doc")).id, db);

    await setSubscription(artifact, "all", actor(viewer), db);
    const followed = await createComment(artifact, { body: "General update" }, actor(owner), "ui", db);
    let rows = await db.query.notifications.findMany({
      where: eq(schema.notifications.commentId, followed.comment.id),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: viewer.id, type: "comment" });

    await setSubscription(artifact, "mentions", actor(viewer), db);
    const mentioned = await createComment(
      artifact,
      { body: `Please review @${viewer.username} and again @${viewer.username}` },
      actor(owner),
      "ui",
      db,
    );
    rows = await db.query.notifications.findMany({
      where: eq(schema.notifications.commentId, mentioned.comment.id),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: viewer.id, type: "mention" });

    await setSubscription(artifact, "muted", actor(viewer), db);
    const muted = await createComment(
      artifact,
      { body: `Muted mention @${viewer.username}` },
      actor(owner),
      "ui",
      db,
    );
    rows = await db.query.notifications.findMany({
      where: eq(schema.notifications.commentId, muted.comment.id),
    });
    expect(rows).toHaveLength(0);
  });

  it("merges versions, comments, and system events into an access-controlled activity timeline", async () => {
    const artifact = await findCollaborationArtifact((await makeArtifact("doc")).id, db);
    const comment = await createComment(artifact, { body: "Timeline handoff" }, actor(viewer), "ui", db);
    await db.insert(schema.auditEvents).values({
      actorId: owner.id,
      action: "assignment.status.change",
      targetType: "artifact",
      targetId: artifact.id,
      metadata: { oldValue: "open", newValue: "in_progress" },
    });

    const firstPage = await listArtifactActivity(artifact.id, actor(viewer), { limit: 2 }, db);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = await listArtifactActivity(
      artifact.id,
      actor(viewer),
      { limit: 2, cursor: firstPage.nextCursor! },
      db,
    );
    const ids = [...firstPage.items, ...secondPage.items].map((item) => item.id);
    expect(ids).toContain(`comment:${comment.comment.id}`);
    expect([...firstPage.items, ...secondPage.items].some((item) => item.source === "version")).toBe(true);
    expect([...firstPage.items, ...secondPage.items].some((item) => item.source === "system")).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    await expect(
      listArtifactActivity(artifact.id, actor(outsider), { limit: 5 }, db),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("backfills missing usernames idempotently with collision-safe suffixes", async () => {
    const local = `legacysame${Date.now()}`;
    const [first, second] = await db
      .insert(schema.users)
      .values([
        { name: "Legacy One", email: `${local}@one.test` },
        { name: "Legacy Two", email: `${local}@two.test` },
      ])
      .returning();
    createdUserIds.push(first.id, second.id);

    expect(await backfillMissingUsernames(db)).toBe(2);
    expect(await backfillMissingUsernames(db)).toBe(0);
    const rows = await db.query.users.findMany({
      where: inArray(schema.users.id, [first.id, second.id]),
      columns: { username: true },
    });
    expect(rows.every((row) => row.username !== null)).toBe(true);
    expect(new Set(rows.map((row) => row.username)).size).toBe(2);
    expect(await db.query.users.findFirst({ where: isNull(schema.users.username) })).toBeUndefined();
  });
});
