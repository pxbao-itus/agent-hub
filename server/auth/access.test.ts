import { describe, it, expect } from "vitest";
import { resolveAccessibleGroups } from "./access";

const team1 = { id: "team-1", departmentId: "dept-1" };
const team2 = { id: "team-2", departmentId: "dept-2" };
const dept1 = { id: "dept-1", orgId: "org-1" };
const dept2 = { id: "dept-2", orgId: "org-1" };
const dept3 = { id: "dept-3", orgId: "org-2" };

const teamsMap = new Map([
  [team1.id, team1],
  [team2.id, team2],
]);
const deptsMap = new Map([
  [dept1.id, dept1],
  [dept2.id, dept2],
  [dept3.id, dept3],
]);

function ids(groups: { groupType: string; groupId: string }[]) {
  return groups.map((g) => `${g.groupType}:${g.groupId}`).sort();
}

describe("resolveAccessibleGroups", () => {
  it("returns empty array when user has no memberships", () => {
    expect(resolveAccessibleGroups([], teamsMap, deptsMap)).toEqual([]);
  });

  it("org membership gives access to that org only", () => {
    const result = resolveAccessibleGroups(
      [{ groupType: "org", groupId: "org-1" }],
      teamsMap,
      deptsMap,
    );
    expect(ids(result)).toEqual(["org:org-1"]);
  });

  it("department membership inherits parent org", () => {
    const result = resolveAccessibleGroups(
      [{ groupType: "department", groupId: "dept-1" }],
      teamsMap,
      deptsMap,
    );
    expect(ids(result)).toEqual(["department:dept-1", "org:org-1"].sort());
  });

  it("team membership inherits parent department and org", () => {
    const result = resolveAccessibleGroups(
      [{ groupType: "team", groupId: "team-1" }],
      teamsMap,
      deptsMap,
    );
    expect(ids(result)).toEqual(
      ["team:team-1", "department:dept-1", "org:org-1"].sort(),
    );
  });

  it("multiple memberships at different levels are merged without duplicates", () => {
    const result = resolveAccessibleGroups(
      [
        { groupType: "team", groupId: "team-1" },
        { groupType: "team", groupId: "team-2" },
      ],
      teamsMap,
      deptsMap,
    );
    // team-1 → dept-1 → org-1; team-2 → dept-2 → org-1 (same org, no dup)
    expect(ids(result)).toEqual(
      ["team:team-1", "team:team-2", "department:dept-1", "department:dept-2", "org:org-1"].sort(),
    );
  });

  it("explicit org membership + team in same org produces no duplicates", () => {
    const result = resolveAccessibleGroups(
      [
        { groupType: "org", groupId: "org-1" },
        { groupType: "team", groupId: "team-1" },
      ],
      teamsMap,
      deptsMap,
    );
    const resultIds = ids(result);
    // org-1 should appear exactly once
    expect(resultIds.filter((id) => id === "org:org-1")).toHaveLength(1);
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
});
