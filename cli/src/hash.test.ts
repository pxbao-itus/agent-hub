import { describe, expect, it } from "vitest";
import { hashContent } from "./hash.js";

describe("hashContent", () => {
  it("is deterministic for the same body + files", () => {
    const a = hashContent("body", [{ path: "a.md", content: "1" }]);
    const b = hashContent("body", [{ path: "a.md", content: "1" }]);
    expect(a).toBe(b);
  });

  it("is order-independent for files (sorted internally)", () => {
    const a = hashContent("body", [
      { path: "b.md", content: "2" },
      { path: "a.md", content: "1" },
    ]);
    const b = hashContent("body", [
      { path: "a.md", content: "1" },
      { path: "b.md", content: "2" },
    ]);
    expect(a).toBe(b);
  });

  it("changes when the body changes", () => {
    expect(hashContent("body1")).not.toBe(hashContent("body2"));
  });

  it("changes when a file's content changes", () => {
    const a = hashContent("body", [{ path: "a.md", content: "1" }]);
    const b = hashContent("body", [{ path: "a.md", content: "2" }]);
    expect(a).not.toBe(b);
  });

  it("changes when a file is added or removed", () => {
    const withFile = hashContent("body", [{ path: "a.md", content: "1" }]);
    const withoutFile = hashContent("body", []);
    expect(withFile).not.toBe(withoutFile);
  });

  it("distinguishes a path/content boundary shift (no delimiter collision)", () => {
    const a = hashContent("body", [{ path: "ab", content: "c" }]);
    const b = hashContent("body", [{ path: "a", content: "bc" }]);
    expect(a).not.toBe(b);
  });
});
