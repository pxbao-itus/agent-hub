import { describe, expect, it } from "vitest";
import {
  extractMentionUsernames,
  normalizeUsernameCandidate,
  validateUsername,
} from "./username";

describe("username", () => {
  it("accepts canonical lowercase handles and rejects invalid/reserved values", () => {
    expect(validateUsername("baopx")).toEqual({ ok: true, username: "baopx" });
    expect(validateUsername("bao123").ok).toBe(true);
    expect(validateUsername("12bao").ok).toBe(false);
    expect(validateUsername("BaoPX").ok).toBe(false);
    expect(validateUsername("bao_px").ok).toBe(false);
    expect(validateUsername("root").ok).toBe(false);
  });

  it("normalizes accents, separators, leading digits and reserved values for allocation", () => {
    expect(normalizeUsernameCandidate("Bảo PX")).toBe("baopx");
    expect(normalizeUsernameCandidate("123 User")).toBe("u123user");
    expect(normalizeUsernameCandidate("root")).toBe("rootuser");
  });

  it("extracts and deduplicates mentions without matching email domains", () => {
    expect(
      extractMentionUsernames("Hi @baopx and @user123. Mail a@company.com or repeat @baopx."),
    ).toEqual(["baopx", "user123"]);
  });
});

