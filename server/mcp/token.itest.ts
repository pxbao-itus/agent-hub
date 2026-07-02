import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/server/test-support/test-db";
import * as schema from "@/server/db/schema";
import { generateRawToken, hashToken, tokenPrefix, verifyMcpToken } from "./token";

const { db, close } = createTestDb();

let engMember: typeof schema.users.$inferSelect;
let superadmin: typeof schema.users.$inferSelect;

beforeAll(async () => {
  [engMember] = await db.select().from(schema.users).where(eq(schema.users.email, "eng-member@test.local"));
  [superadmin] = await db.select().from(schema.users).where(eq(schema.users.email, "superadmin@test.local"));
});

afterAll(() => close());

async function insertToken(opts: { userId: string; scope?: unknown; expiresAt?: Date }): Promise<string> {
  const raw = generateRawToken();
  await db.insert(schema.mcpTokens).values({
    userId: opts.userId,
    name: "itest token",
    tokenHash: hashToken(raw),
    tokenPrefix: tokenPrefix(raw),
    scope: opts.scope,
    expiresAt: opts.expiresAt,
  });
  return raw;
}

describe("verifyMcpToken", () => {
  it("returns the identity and scope for a valid, unexpired token", async () => {
    const raw = await insertToken({ userId: engMember.id, scope: { write: true } });
    const identity = await verifyMcpToken(raw, db);
    expect(identity).not.toBeNull();
    expect(identity?.userId).toBe(engMember.id);
    expect(identity?.systemRole).toBe("user");
    expect(identity?.scope).toEqual({ write: true });
  });

  it("reflects the associated user's current systemRole", async () => {
    const raw = await insertToken({ userId: superadmin.id });
    const identity = await verifyMcpToken(raw, db);
    expect(identity?.systemRole).toBe("superadmin");
  });

  it("rejects an expired token", async () => {
    const raw = await insertToken({ userId: engMember.id, expiresAt: new Date(Date.now() - 60_000) });
    const identity = await verifyMcpToken(raw, db);
    expect(identity).toBeNull();
  });

  it("rejects a well-formed but unknown token", async () => {
    const neverInserted = generateRawToken();
    const identity = await verifyMcpToken(neverInserted, db);
    expect(identity).toBeNull();
  });

  it("rejects a raw string with the wrong prefix", async () => {
    const identity = await verifyMcpToken("not-a-real-token", db);
    expect(identity).toBeNull();
  });

  it("falls back to an empty (full-access) scope when the stored scope is malformed", async () => {
    const raw = await insertToken({ userId: engMember.id, scope: { spaces: "not-an-array" } });
    const identity = await verifyMcpToken(raw, db);
    expect(identity).not.toBeNull();
    expect(identity?.scope).toEqual({});
  });
});
