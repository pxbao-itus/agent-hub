import { describe, expect, it } from "vitest";
import { classifyHealthPayload, describeFailure, FAILURE_KINDS } from "./error-copy";

describe("classifyHealthPayload", () => {
  it("blames the database when the probe reports it down", () => {
    expect(classifyHealthPayload({ ok: false, db: false })).toBe("database");
  });

  it("blames the application when the database answers", () => {
    expect(classifyHealthPayload({ ok: true, db: true })).toBe("application");
  });

  // The probe reached the server, so whatever broke the render is ours — an
  // unfamiliar body is no reason to accuse the database.
  it("treats an unrecognised body as an application error", () => {
    expect(classifyHealthPayload(null)).toBe("application");
    expect(classifyHealthPayload({})).toBe("application");
    expect(classifyHealthPayload("not json")).toBe("application");
    expect(classifyHealthPayload({ ok: false })).toBe("application");
    expect(classifyHealthPayload({ db: "false" })).toBe("application");
  });
});

describe("describeFailure", () => {
  it("names the database so the reader knows what to restart", () => {
    const copy = describeFailure("database");
    expect(copy.title).toMatch(/database/i);
    expect(copy.detail).toMatch(/database/i);
  });

  it("distinguishes an unreachable server from a dead database", () => {
    expect(describeFailure("unreachable").title).not.toBe(describeFailure("database").title);
  });

  it("gives every kind non-empty prose that never leaks query internals", () => {
    for (const kind of FAILURE_KINDS) {
      const copy = describeFailure(kind);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
      expect(`${copy.title} ${copy.detail}`).not.toMatch(/select |params:|token_hash/i);
    }
  });
});
