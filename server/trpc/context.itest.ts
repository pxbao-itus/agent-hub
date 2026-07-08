import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/server/test-support/test-db";
import * as schema from "@/server/db/schema";
import { resolveSession } from "./resolve-session";
import { tokenRouter } from "./routers/token";
import type { Context } from "./context";

/**
 * resolveSession is the guard that stops an orphaned JWT (userId no longer in
 * the DB — user deleted, or DB reseeded under a live session) from reaching a
 * protected procedure and 500-ing at the first FK-constrained write. It must
 * drop such a session to null so protectedProcedure returns a clean
 * UNAUTHORIZED instead.
 */
const { db, close } = createTestDb();

let engMember: typeof schema.users.$inferSelect;

beforeAll(async () => {
  [engMember] = await db.select().from(schema.users).where(eq(schema.users.email, "eng-member@test.local"));
});

afterAll(() => close());

describe("resolveSession", () => {
  it("returns the session for a user that exists", async () => {
    const result = await resolveSession({ id: engMember.id, systemRole: "user" }, db);
    expect(result).toEqual({ userId: engMember.id, systemRole: "user" });
  });

  it("preserves systemRole from the token", async () => {
    const result = await resolveSession({ id: engMember.id, systemRole: "superadmin" }, db);
    expect(result?.systemRole).toBe("superadmin");
  });

  it("defaults systemRole to 'user' when the token omits it", async () => {
    const result = await resolveSession({ id: engMember.id }, db);
    expect(result).toEqual({ userId: engMember.id, systemRole: "user" });
  });

  it("drops an orphaned session (userId absent from the DB) to null", async () => {
    // A well-formed uuid that isn't any seeded user — the exact shape of the
    // bug: JWT carries a userId whose row no longer exists.
    const result = await resolveSession({ id: "6bc1ba83-598c-4928-be17-57dd00ec7e76", systemRole: "user" }, db);
    expect(result).toBeNull();
  });

  it("returns null when there is no session user", async () => {
    expect(await resolveSession(undefined, db)).toBeNull();
    expect(await resolveSession({ id: null }, db)).toBeNull();
    expect(await resolveSession({}, db)).toBeNull();
  });
});

describe("orphaned session end-to-end (the token.create bug)", () => {
  it("token.create with a null session (what an orphan resolves to) throws UNAUTHORIZED, not a DB error", async () => {
    // Composition proof: resolveSession(orphan) -> null (above), and a null
    // session must be rejected cleanly by protectedProcedure before reaching
    // the FK-constrained insert that produced the raw 500.
    const ctx: Context = { db, session: null };
    const caller = tokenRouter.createCaller(ctx);

    await expect(
      caller.create({ name: "claude-desktop", scope: { spaces: [], tags: ["baopx"], write: true } }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("token.create with a valid session succeeds (guard doesn't block real users)", async () => {
    const ctx: Context = { db, session: { userId: engMember.id, systemRole: "user" } };
    const caller = tokenRouter.createCaller(ctx);

    const token = await caller.create({ name: "ctx-itest-token", scope: { spaces: [], tags: ["baopx"], write: true } });
    expect(token.rawToken).toMatch(/^mcp_/);

    // access.itest.ts asserts exact counts against the shared DB; clean up.
    await db.delete(schema.mcpTokens).where(eq(schema.mcpTokens.id, token.id));
  });
});
