import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { createTestDb } from "@/server/test-support/test-db";
import * as schema from "@/server/db/schema";
import { resolveOwnerSlugPaths } from "./owner-path";
import { orgRouter } from "@/server/trpc/routers/org";
import type { Context } from "@/server/trpc/context";

const { db, close } = createTestDb();

function callerAs(identity: { userId: string; systemRole: "user" | "superadmin" }) {
  const ctx: Context = { db, session: identity };
  return orgRouter.createCaller(ctx);
}

// Dedicated org/dept/team hierarchy for this file, so cache-hit assertions
// aren't at the mercy of some other *.itest.ts file having already warmed
// (or not) the process-wide slug-path cache for a shared seed fixture id.
let org: typeof schema.orgs.$inferSelect;
let dept: typeof schema.departments.$inferSelect;
let team: typeof schema.teams.$inferSelect;
let superadmin: typeof schema.users.$inferSelect;

beforeAll(async () => {
  [superadmin] = await db.select().from(schema.users).where(eq(schema.users.email, "superadmin@test.local"));
  [org] = await db.insert(schema.orgs).values({ name: "Slug Cache Org", slug: "slug-cache-org" }).returning();
  [dept] = await db
    .insert(schema.departments)
    .values({ orgId: org.id, name: "Slug Cache Dept", slug: "slug-cache-dept" })
    .returning();
  [team] = await db
    .insert(schema.teams)
    .values({ departmentId: dept.id, name: "Slug Cache Team", slug: "slug-cache-team" })
    .returning();
});

afterAll(async () => {
  await db.delete(schema.orgs).where(eq(schema.orgs.id, org.id));
  await close();
});

function countQueries(fn: () => Promise<void>): Promise<number> {
  let count = 0;
  const original = Pool.prototype.query;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalAny: (...args: any[]) => any = original;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Pool.prototype as any).query = function (this: unknown, ...args: any[]) {
    count++;
    return originalAny.apply(this, args);
  };
  return fn()
    .then(() => count)
    .finally(() => {
      Pool.prototype.query = original;
    });
}

describe("resolveOwnerSlugPaths — process-wide cache", () => {
  it("resolves the correct hierarchical path", async () => {
    const paths = await resolveOwnerSlugPaths([{ ownerType: "team", ownerId: team.id }], db);
    expect(paths.get(`team:${team.id}`)).toBe("slug-cache-org.slug-cache-dept.slug-cache-team");
  });

  it("issues zero DB queries on a repeat lookup for the same owner", async () => {
    // Warm the cache (may or may not already be warm from the test above).
    await resolveOwnerSlugPaths([{ ownerType: "team", ownerId: team.id }], db);

    const queries = await countQueries(async () => {
      const paths = await resolveOwnerSlugPaths([{ ownerType: "team", ownerId: team.id }], db);
      expect(paths.get(`team:${team.id}`)).toBe("slug-cache-org.slug-cache-dept.slug-cache-team");
    });
    expect(queries).toBe(0);
  });

  it("only queries for the uncached subset when mixing hit + miss owners", async () => {
    const [freshTeam] = await db
      .insert(schema.teams)
      .values({ departmentId: dept.id, name: "Fresh Team", slug: "fresh-team" })
      .returning();

    // team.id is already cached from prior tests; freshTeam is not.
    const queries = await countQueries(async () => {
      const paths = await resolveOwnerSlugPaths(
        [{ ownerType: "team", ownerId: team.id }, { ownerType: "team", ownerId: freshTeam.id }],
        db,
      );
      expect(paths.get(`team:${team.id}`)).toBe("slug-cache-org.slug-cache-dept.slug-cache-team");
      expect(paths.get(`team:${freshTeam.id}`)).toBe("slug-cache-org.slug-cache-dept.fresh-team");
    });
    expect(queries).toBeGreaterThan(0); // freshTeam still had to be resolved from DB
  });

  it("invalidates the whole cache when a team's slug is renamed via org.department.team.update", async () => {
    await resolveOwnerSlugPaths([{ ownerType: "team", ownerId: team.id }], db); // ensure warm

    await callerAs({ userId: superadmin.id, systemRole: "superadmin" }).department.team.update({
      teamId: team.id,
      slug: "renamed-team",
    });

    const paths = await resolveOwnerSlugPaths([{ ownerType: "team", ownerId: team.id }], db);
    expect(paths.get(`team:${team.id}`)).toBe("slug-cache-org.slug-cache-dept.renamed-team");
  });

  it("invalidates descendant team paths when the parent department's slug is renamed", async () => {
    await resolveOwnerSlugPaths([{ ownerType: "team", ownerId: team.id }], db); // ensure warm with old dept slug

    await callerAs({ userId: superadmin.id, systemRole: "superadmin" }).department.update({
      departmentId: dept.id,
      slug: "renamed-dept",
    });

    const paths = await resolveOwnerSlugPaths([{ ownerType: "team", ownerId: team.id }], db);
    expect(paths.get(`team:${team.id}`)).toContain("renamed-dept.");
  });
});
