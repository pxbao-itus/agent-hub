import { describe, expect, it } from "vitest";
import { classifySync } from "./diff.js";

describe("classifySync", () => {
  it("up-to-date when neither disk nor remote changed", () => {
    expect(classifySync("h1", "h1", "h1")).toBe("up-to-date");
  });

  it("update when only remote changed", () => {
    expect(classifySync("h1", "h1", "h2")).toBe("update");
  });

  it("local-only when only disk changed", () => {
    expect(classifySync("h2", "h1", "h1")).toBe("local-only");
  });

  it("conflict when both disk and remote changed (and differently)", () => {
    expect(classifySync("h2", "h1", "h3")).toBe("conflict");
  });

  it("treats a missing disk copy (null) as update, never a conflict", () => {
    expect(classifySync(null, "h1", "h1")).toBe("update");
    expect(classifySync(null, "h1", "h2")).toBe("update");
  });
});
