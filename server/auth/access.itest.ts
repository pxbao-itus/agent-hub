import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/server/test-support/test-db";
import * as schema from "@/server/db/schema";
import {
  canAccessArtifact,
  artifactAccessCondition,
  canMutatePrompt,
  canShareArtifact,
  effectiveGroupRole,
  getSharedArtifactIds,
} from "./access";

/**
 * Integration tests against the real agenthub_test fixtures (see
 * server/db/seed-test.ts). Run via `pnpm test:integration`, which reseeds
 * first — these tests assume that exact fixture set and do not mutate data.
 *
 * These lock in the permission model's two independent inheritance rules
 * (D-016, docs/decisions.md) — easy to get backwards when reasoning about
 * them in the abstract:
 *  - READ (getAccessibleGroups / canAccessArtifact / artifactAccessCondition)
 *    inherits BOTH WAYS from each direct membership: a team member sees
 *    group artifacts owned by their team, its ancestors (dept, org), AND —
 *    since D-016 — its descendants too (a team has none, but a dept/org
 *    membership does). It never sees a *sibling* group's artifacts (e.g. a
 *    different team under the same dept) — that would only happen by
 *    wrongly expanding downward from an ancestor reached via upward
 *    traversal, which resolveAccessibleGroups's unit tests guard against
 *    directly (server/auth/access.test.ts).
 *  - MUTATE/SHARE authority (effectiveGroupRole) inherits DOWNWARD ONLY, and
 *    is unaffected by D-016: a role held at a higher level (e.g. org admin)
 *    authorizes managing artifacts owned by anything under it, but a
 *    lower-level membership (e.g. a team editor) does NOT authorize managing
 *    its own parent dept's or org's directly-owned artifacts, and a *read*
 *    role (viewer) never authorizes mutating anything regardless of level.
 * orgAdmin and orgViewer both have only an org-level membership (no direct
 * team/dept membership) — orgAdmin as role "admin", orgViewer as role
 * "viewer". Both now read every descendant group artifact (D-016); only
 * orgAdmin can also mutate/share them.
 */

const { db, close } = createTestDb();

let engMember: typeof schema.users.$inferSelect;
let marketingMember: typeof schema.users.$inferSelect;
let orgAdmin: typeof schema.users.$inferSelect;
let orgViewer: typeof schema.users.$inferSelect;
let outsider: typeof schema.users.$inferSelect;

let org: typeof schema.orgs.$inferSelect;
let engineering: typeof schema.departments.$inferSelect;
let backend: typeof schema.teams.$inferSelect;

let prompt1: typeof schema.artifacts.$inferSelect; // group, team backend
let prompt2: typeof schema.artifacts.$inferSelect; // private, owned by engMember, shared with marketingMember (viewer)
let prompt3: typeof schema.artifacts.$inferSelect; // public, owned by org
let plan2: typeof schema.artifacts.$inferSelect; // group, dept engineering
let skill3: typeof schema.artifacts.$inferSelect; // private, owned by marketingMember, not shared

async function userByEmail(email: string) {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!row) throw new Error(`Fixture user not found: ${email} — did db:seed:test run?`);
  return row;
}

async function artifactByTitle(title: string) {
  const [row] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.title, title));
  if (!row) throw new Error(`Fixture artifact not found: ${title} — did db:seed:test run?`);
  return row;
}

beforeAll(async () => {
  [engMember, marketingMember, orgAdmin, orgViewer, outsider] = await Promise.all([
    userByEmail("eng-member@test.local"),
    userByEmail("marketing-member@test.local"),
    userByEmail("org-admin@test.local"),
    userByEmail("org-viewer@test.local"),
    userByEmail("outsider@test.local"),
  ]);

  [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.slug, "qa-org"));
  [engineering] = await db
    .select()
    .from(schema.departments)
    .where(eq(schema.departments.slug, "engineering"));
  [backend] = await db.select().from(schema.teams).where(eq(schema.teams.slug, "backend"));

  [prompt1, prompt2, prompt3, plan2, skill3] = await Promise.all([
    artifactByTitle("Rà soát bảo mật mã nguồn"),
    artifactByTitle("Summarize meeting notes"),
    artifactByTitle("Viết email xin nghỉ phép"),
    artifactByTitle("Migrate to Next.js 16"),
    artifactByTitle("Debug memory leaks in Node.js"),
  ]);
});

afterAll(() => close());

describe("canAccessArtifact", () => {
  it("superadmin bypasses every check", async () => {
    const ok = await canAccessArtifact({ userId: outsider.id, systemRole: "superadmin" }, prompt1, db);
    expect(ok).toBe(true);
  });

  it("public artifacts are visible to anyone, including a user with no membership", async () => {
    const ok = await canAccessArtifact({ userId: outsider.id, systemRole: "user" }, prompt3, db);
    expect(ok).toBe(true);
  });

  it("a private user-owned artifact is visible to its owner", async () => {
    const ok = await canAccessArtifact({ userId: engMember.id, systemRole: "user" }, prompt2, db);
    expect(ok).toBe(true);
  });

  it("a private user-owned artifact is NOT visible to an unrelated user", async () => {
    const ok = await canAccessArtifact({ userId: engMember.id, systemRole: "user" }, skill3, db);
    expect(ok).toBe(false);
  });

  it("a share grants read access across the team boundary", async () => {
    // prompt2 is private to engMember; shared with marketingMember as viewer.
    const ok = await canAccessArtifact({ userId: marketingMember.id, systemRole: "user" }, prompt2, db);
    expect(ok).toBe(true);
  });

  it("a direct team member sees a group artifact owned by their own team", async () => {
    const ok = await canAccessArtifact({ userId: engMember.id, systemRole: "user" }, prompt1, db);
    expect(ok).toBe(true);
  });

  it("a member of a different team does NOT see it (negative access case)", async () => {
    const ok = await canAccessArtifact({ userId: marketingMember.id, systemRole: "user" }, prompt1, db);
    expect(ok).toBe(false);
  });

  it("an org-level member DOES see a descendant team's group artifact (D-016 — read now inherits downward too)", async () => {
    const ok = await canAccessArtifact({ userId: orgAdmin.id, systemRole: "user" }, prompt1, db);
    expect(ok).toBe(true);
  });

  it("downward read applies to a viewer-role org member too, not just admin", async () => {
    const ok = await canAccessArtifact({ userId: orgViewer.id, systemRole: "user" }, prompt1, db);
    expect(ok).toBe(true);
  });

  it("an org-level member DOES see a group artifact owned directly by the org", async () => {
    // Synthesized artifact shape — canAccessArtifact only needs these fields
    // and doesn't require the id to resolve to a real row for the group branch.
    const orgOwnedGroupArtifact = {
      id: "00000000-0000-4000-8000-000000000000",
      ownerType: "org" as const,
      ownerId: org.id,
      visibility: "group" as const,
    };
    const ok = await canAccessArtifact({ userId: orgAdmin.id, systemRole: "user" }, orgOwnedGroupArtifact, db);
    expect(ok).toBe(true);
  });
});

describe("effectiveGroupRole (mutate/share authority — inherits DOWNWARD)", () => {
  it("a direct team member has their membership role on that team", async () => {
    expect(await effectiveGroupRole(engMember.id, "team", backend.id, db)).toBe("editor");
  });

  it("an org admin's role flows down to a descendant team", async () => {
    expect(await effectiveGroupRole(orgAdmin.id, "team", backend.id, db)).toBe("admin");
  });

  it("an org viewer's role also flows down (as viewer, not admin) — role rank is preserved, not upgraded", async () => {
    expect(await effectiveGroupRole(orgViewer.id, "team", backend.id, db)).toBe("viewer");
  });

  it("a team membership does NOT flow up to the parent department's own role", async () => {
    // engMember is only a member of team backend, not of department engineering
    // itself — they get no role when asked about the department as an owner.
    expect(await effectiveGroupRole(engMember.id, "department", engineering.id, db)).toBeNull();
  });

  it("memberships in an unrelated lineage produce no role", async () => {
    expect(await effectiveGroupRole(marketingMember.id, "team", backend.id, db)).toBeNull();
  });

  it("a user with no memberships anywhere has no role", async () => {
    expect(await effectiveGroupRole(outsider.id, "team", backend.id, db)).toBeNull();
  });
});

describe("canMutatePrompt", () => {
  it("superadmin can always mutate", async () => {
    const ok = await canMutatePrompt({ userId: outsider.id, systemRole: "superadmin" }, prompt1, db);
    expect(ok).toBe(true);
  });

  it("a direct team editor can mutate their team's artifact", async () => {
    const ok = await canMutatePrompt({ userId: engMember.id, systemRole: "user" }, prompt1, db);
    expect(ok).toBe(true);
  });

  it("a member of a different team cannot mutate it", async () => {
    const ok = await canMutatePrompt({ userId: marketingMember.id, systemRole: "user" }, prompt1, db);
    expect(ok).toBe(false);
  });

  it("an org admin can mutate a descendant team's artifact (authority flows down)", async () => {
    const ok = await canMutatePrompt({ userId: orgAdmin.id, systemRole: "user" }, prompt1, db);
    expect(ok).toBe(true);
  });

  it("an org viewer can READ a descendant team's artifact but cannot mutate it (D-016 only changed read)", async () => {
    expect(await canAccessArtifact({ userId: orgViewer.id, systemRole: "user" }, prompt1, db)).toBe(true);
    expect(await canMutatePrompt({ userId: orgViewer.id, systemRole: "user" }, prompt1, db)).toBe(false);
  });

  it("a team editor cannot mutate their parent department's own artifact", async () => {
    const ok = await canMutatePrompt({ userId: engMember.id, systemRole: "user" }, plan2, db);
    expect(ok).toBe(false);
  });

  it("a viewer share does NOT grant mutate rights (only editor share would)", async () => {
    const ok = await canMutatePrompt({ userId: marketingMember.id, systemRole: "user" }, prompt2, db);
    expect(ok).toBe(false);
  });
});

describe("canShareArtifact", () => {
  it("an editor (not admin) cannot share their team's artifact", async () => {
    const ok = await canShareArtifact({ userId: engMember.id, systemRole: "user" }, prompt1, db);
    expect(ok).toBe(false);
  });

  it("an org admin can share a descendant team's artifact", async () => {
    const ok = await canShareArtifact({ userId: orgAdmin.id, systemRole: "user" }, prompt1, db);
    expect(ok).toBe(true);
  });

  it("the owner of a user-owned artifact can share it", async () => {
    const ok = await canShareArtifact({ userId: engMember.id, systemRole: "user" }, prompt2, db);
    expect(ok).toBe(true);
  });

  it("a non-owner with only a share on a user-owned artifact cannot re-share it", async () => {
    const ok = await canShareArtifact({ userId: marketingMember.id, systemRole: "user" }, prompt2, db);
    expect(ok).toBe(false);
  });
});

describe("getSharedArtifactIds", () => {
  it("returns the share role keyed by artifact id", async () => {
    const shared = await getSharedArtifactIds(marketingMember.id, db);
    expect(shared.get(prompt2.id)).toBe("viewer");
  });

  it("is empty for a user with no shares", async () => {
    const shared = await getSharedArtifactIds(outsider.id, db);
    expect(shared.size).toBe(0);
  });
});

describe("artifactAccessCondition (full accessible set via a real query)", () => {
  async function accessibleTitles(userId: string, systemRole: "user" | "superadmin") {
    const condition = await artifactAccessCondition(userId, systemRole, db);
    const rows = condition
      ? await db.select({ title: schema.artifacts.title }).from(schema.artifacts).where(condition)
      : await db.select({ title: schema.artifacts.title }).from(schema.artifacts);
    return new Set(rows.map((r) => r.title));
  }

  it("a backend team member sees every artifact except another user's unshared private one", async () => {
    const titles = await accessibleTitles(engMember.id, "user");
    expect(titles.has(skill3.title)).toBe(false);
    expect(titles.size).toBe(14); // 15 seeded artifacts minus skill3
  });

  it("a content team member (different lineage) sees only public + their own + shared", async () => {
    const titles = await accessibleTitles(marketingMember.id, "user");
    expect(titles).toEqual(
      new Set([
        "Viết email xin nghỉ phép", // public
        "Bộ kit onboarding", // public
        "Kế hoạch onboarding nhân viên mới", // public
        "Quy trình onboarding nhân viên", // public
        skill3.title, // own private
        prompt2.title, // shared with them (viewer)
      ]),
    );
  });

  it("an outsider with no membership sees only public artifacts", async () => {
    const titles = await accessibleTitles(outsider.id, "user");
    expect(titles).toEqual(
      new Set([
        "Viết email xin nghỉ phép",
        "Bộ kit onboarding",
        "Kế hoạch onboarding nhân viên mới",
        "Quy trình onboarding nhân viên",
      ]),
    );
  });

  it("an org admin with no direct team/dept membership sees every group artifact under the org (D-016 — read inherits downward)", async () => {
    const titles = await accessibleTitles(orgAdmin.id, "user");
    // Every seeded artifact except the 3 private ones not owned by / shared
    // with orgAdmin (prompt2, skill3, kit3) — public + every group-visibility
    // artifact anywhere under qa-org, regardless of which dept/team owns it.
    expect(titles.size).toBe(12);
    expect(titles.has(prompt2.title)).toBe(false);
    expect(titles.has(skill3.title)).toBe(false);
    expect(titles.has(prompt1.title)).toBe(true); // team backend, group
    expect(titles.has(plan2.title)).toBe(true); // dept engineering, group
  });

  it("an org viewer (no admin/editor role anywhere) reads the same expanded set as an org admin", async () => {
    const orgAdminTitles = await accessibleTitles(orgAdmin.id, "user");
    const orgViewerTitles = await accessibleTitles(orgViewer.id, "user");
    expect(orgViewerTitles).toEqual(orgAdminTitles);
  });

  it("superadmin's condition is undefined (unfiltered) and returns every seeded artifact", async () => {
    const titles = await accessibleTitles(outsider.id, "superadmin");
    expect(titles.size).toBe(15);
  });
});
