import { describe, expect, it } from "vitest";
import { findActiveMention, replaceActiveMention } from "./mention-autocomplete";

describe("mention autocomplete", () => {
  it("opens for a bare @ and follows the query at the caret", () => {
    expect(findActiveMention("Handoff to @", 12)).toEqual({
      start: 11,
      end: 12,
      query: "",
    });
    expect(findActiveMention("Handoff to @bao", 15)).toEqual({
      start: 11,
      end: 15,
      query: "bao",
    });
  });

  it("does not trigger inside an email or after a completed mention", () => {
    expect(findActiveMention("mail a@company", 14)).toBeNull();
    expect(findActiveMention("Hi @baopx ", 10)).toBeNull();
  });

  it("replaces only the active token and keeps the canonical username", () => {
    expect(
      replaceActiveMention(
        "Ask @ba about this",
        { start: 4, end: 7, query: "ba" },
        "baopx",
      ),
    ).toEqual({
      value: "Ask @baopx about this",
      caret: 10,
    });
  });
});
