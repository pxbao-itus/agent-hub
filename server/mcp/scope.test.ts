import { describe, it, expect } from "vitest";
import {
  parseScope,
  applyScopeToOwners,
  promptPassesScopeTags,
  validateScopeAgainstAccess,
} from "./scope";
import type { GroupRef } from "@/server/auth/access";

const org1: GroupRef = { groupType: "org", groupId: "11111111-1111-4111-8111-111111111111" };
const team1: GroupRef = { groupType: "team", groupId: "22222222-2222-4222-8222-222222222222" };
const team2: GroupRef = { groupType: "team", groupId: "33333333-3333-4333-8333-333333333333" };
const accessibleGroups = [org1, team1];

describe("parseScope", () => {
  it("passes through a valid scope", () => {
    const scope = parseScope({ spaces: [{ groupType: "team", groupId: team1.groupId }], tags: ["a"] });
    expect(scope.spaces).toHaveLength(1);
    expect(scope.tags).toEqual(["a"]);
  });

  it("falls back to an empty (non-restricting) scope on malformed input", () => {
    // Security note: an invalid scope must NOT grant more access than the
    // token owner already has — it degrades to "no narrowing", not "no limit".
    // Callers always intersect scope with the real accessibleGroups, so {}
    // here is safe (see applyScopeToOwners below).
    expect(parseScope({ spaces: [{ groupType: "team", groupId: "not-a-uuid" }] })).toEqual({});
    expect(parseScope("garbage")).toEqual({});
    expect(parseScope(null)).toEqual({});
    expect(parseScope(undefined)).toEqual({});
  });

  it("treats an empty object as a valid, non-restricting scope", () => {
    expect(parseScope({})).toEqual({});
  });
});

describe("applyScopeToOwners", () => {
  it("returns every accessible group unchanged when the scope has no space restriction", () => {
    expect(applyScopeToOwners({}, accessibleGroups)).toEqual(accessibleGroups);
  });

  it("intersects — narrows accessibleGroups down to the scoped spaces", () => {
    const result = applyScopeToOwners({ spaces: [team1] }, accessibleGroups);
    expect(result).toEqual([team1]);
  });

  it("never adds a space the token owner doesn't already have access to", () => {
    // team2 is in scope.spaces but NOT in accessibleGroups — must not appear.
    const result = applyScopeToOwners({ spaces: [team1, team2] }, accessibleGroups);
    expect(result).toEqual([team1]);
  });

  it("returns an empty list when the scope names only spaces the owner lacks", () => {
    const result = applyScopeToOwners({ spaces: [team2] }, accessibleGroups);
    expect(result).toEqual([]);
  });
});

describe("promptPassesScopeTags", () => {
  it("passes everything when the scope has no tag restriction", () => {
    expect(promptPassesScopeTags([], {})).toBe(true);
    expect(promptPassesScopeTags(["security"], {})).toBe(true);
  });

  it("passes when at least one tag overlaps", () => {
    expect(promptPassesScopeTags(["security", "review"], { tags: ["review"] })).toBe(true);
  });

  it("rejects when no tag overlaps", () => {
    expect(promptPassesScopeTags(["hr"], { tags: ["security"] })).toBe(false);
  });

  it("rejects an untagged artifact against a tag-restricted scope", () => {
    expect(promptPassesScopeTags([], { tags: ["security"] })).toBe(false);
  });
});

describe("validateScopeAgainstAccess", () => {
  it("accepts a scope with no space restriction", () => {
    expect(validateScopeAgainstAccess({}, accessibleGroups)).toBe(true);
  });

  it("accepts a scope whose spaces are all within the creator's access", () => {
    expect(validateScopeAgainstAccess({ spaces: [team1] }, accessibleGroups)).toBe(true);
  });

  it("rejects a scope naming a space outside the creator's access (no privilege escalation via token creation)", () => {
    expect(validateScopeAgainstAccess({ spaces: [team2] }, accessibleGroups)).toBe(false);
  });

  it("rejects if even one space among several is outside the creator's access", () => {
    expect(validateScopeAgainstAccess({ spaces: [team1, team2] }, accessibleGroups)).toBe(false);
  });
});
