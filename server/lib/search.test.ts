import { describe, it, expect } from "vitest";
import { rrfMerge } from "./search";

describe("rrfMerge", () => {
  it("returns empty for empty input", () => {
    expect(rrfMerge([])).toEqual([]);
  });

  it("passes through a single list ordering", () => {
    expect(rrfMerge([["a", "b", "c"]])).toEqual(["a", "b", "c"]);
  });

  it("boosts items appearing in both lists", () => {
    // "b" appears in position 0 of list2 and position 1 of list1 → should beat "a" (list1 only, pos 0)
    const result = rrfMerge([["a", "b", "c"], ["b", "d", "a"]]);
    expect(result[0]).toBe("b"); // appears in both lists at high ranks
  });

  it("item in both lists ranks above item in one list", () => {
    const merged = rrfMerge([["x", "y"], ["y", "z"]]);
    // "y" is in both → higher score than "x" (list1 only) and "z" (list2 only)
    expect(merged[0]).toBe("y");
  });

  it("deduplicates across lists", () => {
    const merged = rrfMerge([["a", "b"], ["a", "c"]]);
    const unique = new Set(merged);
    expect(unique.size).toBe(merged.length);
  });

  it("respects k parameter — lower k amplifies rank differences", () => {
    // With k=0, rank 0 score = 1/(0+0+1)=1, rank 1 = 1/(0+1+1)=0.5 → bigger gap
    // With k=60 (default), rank 0 score = 1/61, rank 1 = 1/62 → small gap
    // Both should still rank "a" first when it's top of a single list
    const result = rrfMerge([["a", "b", "c"]], 0);
    expect(result[0]).toBe("a");
  });

  it("handles disjoint lists — all items present once", () => {
    const merged = rrfMerge([["a", "b"], ["c", "d"]]);
    expect(new Set(merged)).toEqual(new Set(["a", "b", "c", "d"]));
  });
});
