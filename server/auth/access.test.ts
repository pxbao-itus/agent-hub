import { describe, it, expect } from "vitest";
import { resolveAccessibleGroups } from "./access";

// org-1
//   dept-1
//     team-1
//     team-2
//   dept-2
//     team-3
//     team-4
// org-2
//   dept-3
//     team-5
const team1 = { id: "team-1", departmentId: "dept-1" };
const team2 = { id: "team-2", departmentId: "dept-1" };
const team3 = { id: "team-3", departmentId: "dept-2" };
const team4 = { id: "team-4", departmentId: "dept-2" };
const team5 = { id: "team-5", departmentId: "dept-3" };
const dept1 = { id: "dept-1", orgId: "org-1" };
const dept2 = { id: "dept-2", orgId: "org-1" };
const dept3 = { id: "dept-3", orgId: "org-2" };

const teamsMap = new Map([team1, team2, team3, team4, team5].map((t) => [t.id, t]));
const deptsMap = new Map([dept1, dept2, dept3].map((d) => [d.id, d]));

function ids(groups: { groupType: string; groupId: string }[]) {
  return groups.map((g) => `${g.groupType}:${g.groupId}`).sort();
}

describe("resolveAccessibleGroups", () => {
  it("returns empty array when user has no memberships", () => {
    expect(resolveAccessibleGroups([], teamsMap, deptsMap)).toEqual([]);
  });

  it("org membership includes every descendant dept and team (read inherits downward)", () => {
    const result = resolveAccessibleGroups(
      [{ groupType: "org", groupId: "org-1" }],
      teamsMap,
      deptsMap,
    );
    expect(ids(result)).toEqual(
      [
        "org:org-1",
        "department:dept-1",
        "department:dept-2",
        "team:team-1",
        "team:team-2",
        "team:team-3",
        "team:team-4",
      ].sort(),
    );
  });

  it("org membership does NOT include a different org's depts/teams (sibling-org leak guard)", () => {
    const result = resolveAccessibleGroups(
      [{ groupType: "org", groupId: "org-1" }],
      teamsMap,
      deptsMap,
    );
    const resultIds = ids(result);
    expect(resultIds).not.toContain("department:dept-3");
    expect(resultIds).not.toContain("team:team-5");
  });

  it("department membership inherits the parent org (upward) and its own teams (downward), not a sibling department's teams", () => {
    const result = resolveAccessibleGroups(
      [{ groupType: "department", groupId: "dept-1" }],
      teamsMap,
      deptsMap,
    );
    expect(ids(result)).toEqual(
      ["department:dept-1", "org:org-1", "team:team-1", "team:team-2"].sort(),
    );
  });

  it("team membership inherits parent department and org (upward only — teams have no children)", () => {
    const result = resolveAccessibleGroups(
      [{ groupType: "team", groupId: "team-1" }],
      teamsMap,
      deptsMap,
    );
    expect(ids(result)).toEqual(["team:team-1", "department:dept-1", "org:org-1"].sort());
  });

  it("sibling-leak guard: a team membership does NOT grant access to a sibling team via the shared parent department", () => {
    const result = resolveAccessibleGroups(
      [{ groupType: "team", groupId: "team-1" }],
      teamsMap,
      deptsMap,
    );
    expect(ids(result)).not.toContain("team:team-2");
  });

  it("sibling-leak guard: a team membership does NOT grant access to a cousin team in a different department via the shared parent org", () => {
    const result = resolveAccessibleGroups(
      [{ groupType: "team", groupId: "team-1" }],
      teamsMap,
      deptsMap,
    );
    const resultIds = ids(result);
    expect(resultIds).not.toContain("team:team-3");
    expect(resultIds).not.toContain("team:team-4");
    expect(resultIds).not.toContain("department:dept-2");
  });

  it("multiple team memberships in the same org are merged without duplicating the shared org", () => {
    const result = resolveAccessibleGroups(
      [
        { groupType: "team", groupId: "team-1" },
        { groupType: "team", groupId: "team-3" },
      ],
      teamsMap,
      deptsMap,
    );
    // team-1 -> dept-1 -> org-1; team-3 -> dept-2 -> org-1 (same org, no dup)
    expect(ids(result)).toEqual(
      ["team:team-1", "team:team-3", "department:dept-1", "department:dept-2", "org:org-1"].sort(),
    );
  });

  it("explicit org membership + a team in that org produces no duplicates", () => {
    const result = resolveAccessibleGroups(
      [
        { groupType: "org", groupId: "org-1" },
        { groupType: "team", groupId: "team-1" },
      ],
      teamsMap,
      deptsMap,
    );
    const resultIds = ids(result);
    expect(resultIds.filter((id) => id === "org:org-1")).toHaveLength(1);
    expect(resultIds.filter((id) => id === "team:team-1")).toHaveLength(1);
  });

  it("team with unknown department id is skipped gracefully", () => {
    const brokenTeamsMap = new Map([["team-x", { id: "team-x", departmentId: "dept-missing" }]]);
    const result = resolveAccessibleGroups(
      [{ groupType: "team", groupId: "team-x" }],
      brokenTeamsMap,
      deptsMap,
    );
    // team is added, but no dept/org (dept-missing not in map)
    expect(ids(result)).toEqual(["team:team-x"]);
  });

  it("department's own org id is trusted from its row (no separate org-row existence check) and its known teams still resolve", () => {
    const brokenDeptsMap = new Map([["dept-x", { id: "dept-x", orgId: "org-missing" }]]);
    const brokenTeamsMap = new Map([["team-y", { id: "team-y", departmentId: "dept-x" }]]);
    const result = resolveAccessibleGroups(
      [{ groupType: "department", groupId: "dept-x" }],
      brokenTeamsMap,
      brokenDeptsMap,
    );
    expect(ids(result)).toEqual(
      ["department:dept-x", "org:org-missing", "team:team-y"].sort(),
    );
  });

  it("org with no known departments in the given maps produces just the org", () => {
    const result = resolveAccessibleGroups(
      [{ groupType: "org", groupId: "org-2" }],
      new Map(),
      new Map(),
    );
    expect(ids(result)).toEqual(["org:org-2"]);
  });
});
