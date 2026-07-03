import { describe, it, expect } from "vitest";
import { splitHighlight } from "./highlight-text";

describe("splitHighlight", () => {
  it("marks a single case-insensitive match", () => {
    expect(splitHighlight("PR review checklist", "review")).toEqual([
      { text: "PR ", match: false },
      { text: "review", match: true },
      { text: " checklist", match: false },
    ]);
  });

  it("marks every occurrence of every word in a multi-word query", () => {
    const segs = splitHighlight("review the PR review", "review PR");
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["review", "PR", "review"]);
  });

  it("returns the whole text unmatched for an empty query", () => {
    expect(splitHighlight("hello world", "")).toEqual([{ text: "hello world", match: false }]);
    expect(splitHighlight("hello world", "   ")).toEqual([{ text: "hello world", match: false }]);
  });

  it("returns no match segments when the query doesn't appear", () => {
    const segs = splitHighlight("hello world", "xyz");
    expect(segs.every((s) => !s.match)).toBe(true);
  });

  it("escapes regex special characters in the query", () => {
    const segs = splitHighlight("cost: $5 (approx.)", "$5");
    expect(segs.some((s) => s.match && s.text === "$5")).toBe(true);
  });

  it("does not duplicate-match overlapping words case-insensitively", () => {
    const segs = splitHighlight("Review REVIEW review", "review");
    expect(segs.filter((s) => s.match)).toHaveLength(3);
  });
});
