import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import { createTestDb } from "@/server/test-support/test-db";
import * as schema from "@/server/db/schema";
import { favoriteRouter } from "./favorite";
import type { Context } from "@/server/trpc/context";

const { db, close } = createTestDb();

type Identity = { userId: string; systemRole: "user" | "superadmin" };

function callerAs(identity: Identity) {
  const ctx: Context = { db, session: identity };
  return favoriteRouter.createCaller(ctx);
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
let marketingMember: typeof schema.users.$inferSelect;

beforeAll(async () => {
  engMember = await mustUser("eng-member@test.local");
  marketingMember = await mustUser("marketing-member@test.local");
});

afterEach(async () => {
  // toggle() is the only write path — leave every test's data no dirtier
  // than it found it, so no cross-test isolation tracking is needed here.
  await db.delete(schema.artifactFavorites);
});

afterAll(() => close());

describe("favorite.toggle", () => {
  it("creates a favorite when none exists, then removes it on a second call", async () => {
    const skill1 = await mustArtifact("PR review checklist");
    const caller = callerAs({ userId: engMember.id, systemRole: "user" });

    const first = await caller.toggle({ artifactId: skill1.id });
    expect(first.favorited).toBe(true);

    const [row] = await db
      .select()
      .from(schema.artifactFavorites)
      .where(and(eq(schema.artifactFavorites.userId, engMember.id), eq(schema.artifactFavorites.artifactId, skill1.id)));
    expect(row).toBeDefined();

    const second = await caller.toggle({ artifactId: skill1.id });
    expect(second.favorited).toBe(false);

    const rows = await db
      .select()
      .from(schema.artifactFavorites)
      .where(and(eq(schema.artifactFavorites.userId, engMember.id), eq(schema.artifactFavorites.artifactId, skill1.id)));
    expect(rows).toHaveLength(0);
  });

  it("is scoped per user — one user's favorite doesn't affect another's", async () => {
    const skill1 = await mustArtifact("PR review checklist");
    await callerAs({ userId: engMember.id, systemRole: "user" }).toggle({ artifactId: skill1.id });

    const marketingList = await callerAs({ userId: marketingMember.id, systemRole: "user" }).list();
    expect(marketingList.find((a) => a.id === skill1.id)).toBeUndefined();
  });
});

describe("favorite.list", () => {
  it("returns only the caller's own favorites, newest first", async () => {
    const skill1 = await mustArtifact("PR review checklist");
    const prompt3 = await mustArtifact("Viết email xin nghỉ phép");
    const caller = callerAs({ userId: engMember.id, systemRole: "user" });

    await caller.toggle({ artifactId: skill1.id });
    await caller.toggle({ artifactId: prompt3.id });

    const list = await caller.list();
    expect(list.map((a) => a.id)).toEqual([prompt3.id, skill1.id]);
  });

  it("excludes a favorited artifact the caller can no longer access", async () => {
    // skill3 is private to marketing-member — eng-member has no access to it
    // even if a stale favorite row exists (simulated directly, bypassing
    // toggle, since toggle itself doesn't gate on access — see D-028).
    const skill3 = await mustArtifact("Debug memory leaks in Node.js");
    await db.insert(schema.artifactFavorites).values({ userId: engMember.id, artifactId: skill3.id });

    const list = await callerAs({ userId: engMember.id, systemRole: "user" }).list();
    expect(list.find((a) => a.id === skill3.id)).toBeUndefined();
  });
});
