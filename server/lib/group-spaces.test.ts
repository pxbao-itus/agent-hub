import { describe, expect, it } from "vitest";
import { resolveGroupSpaces } from "./group-spaces";

const orgs = [{ id: "org-1", name: "QA Org" }];
const departments = [
  { id: "dept-eng", name: "Engineering", orgId: "org-1" },
  { id: "dept-mkt", name: "Marketing", orgId: "org-1" },
];
const teams = [
  { id: "team-api", name: "API", departmentId: "dept-eng" },
  { id: "team-web", name: "Web", departmentId: "dept-eng" },
  { id: "team-content", name: "Content", departmentId: "dept-mkt" },
];

describe("resolveGroupSpaces", () => {
  it("returns every group for a superadmin without memberships", () => {
    const result = resolveGroupSpaces({
      systemRole: "superadmin",
      capability: "manageable",
      memberships: [],
      orgs,
      departments,
      teams,
    });

    expect(result).toHaveLength(6);
    expect(result.every((space) => space.effectiveRole === "superadmin")).toBe(true);
  });

  it("inherits org editor authority to every descendant", () => {
    const result = resolveGroupSpaces({
      systemRole: "user",
      capability: "manageable",
      memberships: [{ groupType: "org", groupId: "org-1", role: "editor" }],
      orgs,
      departments,
      teams,
    });

    expect(result.map((space) => `${space.type}:${space.id}`)).toEqual([
      "org:org-1",
      "department:dept-eng",
      "department:dept-mkt",
      "team:team-api",
      "team:team-web",
      "team:team-content",
    ]);
  });

  it("inherits department admin authority only to its child teams", () => {
    const result = resolveGroupSpaces({
      systemRole: "user",
      capability: "manageable",
      memberships: [{ groupType: "department", groupId: "dept-eng", role: "admin" }],
      orgs,
      departments,
      teams,
    });

    expect(result.map((space) => `${space.type}:${space.id}`)).toEqual([
      "department:dept-eng",
      "team:team-api",
      "team:team-web",
    ]);
  });

  it("keeps viewer spaces viewable but excludes them from manageable results", () => {
    const input = {
      systemRole: "user" as const,
      memberships: [{ groupType: "team" as const, groupId: "team-api", role: "viewer" as const }],
      orgs,
      departments,
      teams,
    };

    const viewable = resolveGroupSpaces({ ...input, capability: "viewable" });
    const manageable = resolveGroupSpaces({ ...input, capability: "manageable" });

    expect(viewable.map((space) => `${space.type}:${space.id}`)).toEqual([
      "org:org-1",
      "department:dept-eng",
      "team:team-api",
    ]);
    expect(manageable).toEqual([]);
  });

  it("deduplicates direct and inherited authority using the highest role", () => {
    const result = resolveGroupSpaces({
      systemRole: "user",
      capability: "manageable",
      memberships: [
        { groupType: "org", groupId: "org-1", role: "editor" },
        { groupType: "team", groupId: "team-api", role: "admin" },
      ],
      orgs,
      departments,
      teams,
    });

    expect(result.find((space) => space.id === "team-api")?.effectiveRole).toBe("admin");
    expect(result.filter((space) => space.id === "team-api")).toHaveLength(1);
  });

  it("ignores stale memberships that do not resolve to a group row", () => {
    const result = resolveGroupSpaces({
      systemRole: "user",
      capability: "viewable",
      memberships: [{ groupType: "team", groupId: "missing", role: "admin" }],
      orgs,
      departments,
      teams,
    });

    expect(result).toEqual([]);
  });
});
