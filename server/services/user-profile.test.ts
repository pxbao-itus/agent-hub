import { describe, expect, it } from "vitest";
import { buildProfileMembershipTree } from "./user-profile";

const joinedAt = new Date("2026-07-28T00:00:00.000Z");

describe("buildProfileMembershipTree", () => {
  it("deduplicates ancestors and preserves direct roles", () => {
    const tree = buildProfileMembershipTree({
      direct: [
        { id: "m1", groupType: "department", groupId: "d1", role: "editor", createdAt: joinedAt },
        { id: "m2", groupType: "team", groupId: "t1", role: "viewer", createdAt: joinedAt },
        { id: "m3", groupType: "team", groupId: "t2", role: "admin", createdAt: joinedAt },
      ],
      orgRows: [{ id: "o1", name: "Acme", image: null }],
      departmentRows: [{ id: "d1", orgId: "o1", name: "Engineering", image: null }],
      teamRows: [
        { id: "t1", departmentId: "d1", name: "API", image: null },
        { id: "t2", departmentId: "d1", name: "Web", image: null },
      ],
      openableGroups: new Set(["org:o1", "department:d1", "team:t1"]),
    });

    expect(tree).toHaveLength(1);
    expect(tree[0]?.direct).toBeNull();
    expect(tree[0]?.href).toBe("/settings/orgs/o1");
    expect(tree[0]?.departments).toHaveLength(1);
    expect(tree[0]?.departments[0]?.direct?.role).toBe("editor");
    expect(tree[0]?.departments[0]?.teams.map((team) => team.name)).toEqual(["API", "Web"]);
    expect(tree[0]?.departments[0]?.teams[1]?.href).toBeNull();
  });

  it("does not expand descendants from a direct Organization membership", () => {
    const tree = buildProfileMembershipTree({
      direct: [{ id: "m1", groupType: "org", groupId: "o1", role: "admin", createdAt: joinedAt }],
      orgRows: [{ id: "o1", name: "Acme", image: null }],
      departmentRows: [],
      teamRows: [],
      openableGroups: new Set(),
    });
    expect(tree[0]?.departments).toEqual([]);
    expect(tree[0]?.direct?.role).toBe("admin");
  });
});
