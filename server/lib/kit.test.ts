import { describe, it, expect } from "vitest";
import { wouldCreateCycleInGraph, flattenKitMembersInGraph } from "./kit";

// ── wouldCreateCycleInGraph ───────────────────────────────────────────────────

describe("wouldCreateCycleInGraph", () => {
  it("self-reference is a cycle", () => {
    const graph = new Map<string, string[]>();
    const kitIds = new Set(["kit-a"]);
    expect(wouldCreateCycleInGraph("kit-a", "kit-a", graph, kitIds)).toBe(true);
  });

  it("no cycle — leaf (prompt) member", () => {
    const graph = new Map([["kit-a", ["prompt-1"]]]);
    const kitIds = new Set(["kit-a"]);
    expect(wouldCreateCycleInGraph("kit-a", "prompt-1", graph, kitIds)).toBe(false);
  });

  it("no cycle — candidate is not a kit (leaf always safe)", () => {
    const graph = new Map<string, string[]>();
    const kitIds = new Set(["kit-a"]);
    expect(wouldCreateCycleInGraph("kit-a", "skill-1", graph, kitIds)).toBe(false);
  });

  it("direct cycle — kit-a → kit-b → kit-a", () => {
    // kit-b already contains kit-a; adding kit-b to kit-a would cycle
    const graph = new Map([["kit-b", ["kit-a"]]]);
    const kitIds = new Set(["kit-a", "kit-b"]);
    expect(wouldCreateCycleInGraph("kit-a", "kit-b", graph, kitIds)).toBe(true);
  });

  it("transitive cycle — kit-a → kit-b → kit-c → kit-a", () => {
    const graph = new Map([
      ["kit-b", ["kit-c"]],
      ["kit-c", ["kit-a"]],
    ]);
    const kitIds = new Set(["kit-a", "kit-b", "kit-c"]);
    expect(wouldCreateCycleInGraph("kit-a", "kit-b", graph, kitIds)).toBe(true);
  });

  it("no cycle — deep nesting without loop", () => {
    const graph = new Map([
      ["kit-b", ["kit-c", "prompt-1"]],
      ["kit-c", ["skill-1"]],
    ]);
    const kitIds = new Set(["kit-a", "kit-b", "kit-c"]);
    expect(wouldCreateCycleInGraph("kit-a", "kit-b", graph, kitIds)).toBe(false);
  });

  it("candidate with no members (empty kit) — no cycle", () => {
    const graph = new Map<string, string[]>();
    const kitIds = new Set(["kit-a", "kit-b"]);
    expect(wouldCreateCycleInGraph("kit-a", "kit-b", graph, kitIds)).toBe(false);
  });
});

// ── flattenKitMembersInGraph ──────────────────────────────────────────────────

type GraphEntry = { id: string; kind: string; position: number };

describe("flattenKitMembersInGraph", () => {
  it("empty kit returns empty lists", () => {
    const graph = new Map<string, GraphEntry[]>();
    const result = flattenKitMembersInGraph("kit-a", graph);
    expect(result).toEqual({ prompts: [], skills: [] });
  });

  it("flat kit with prompt + skill", () => {
    const graph = new Map([
      [
        "kit-a",
        [
          { id: "prompt-1", kind: "prompt", position: 0 },
          { id: "skill-1", kind: "skill", position: 1 },
        ],
      ],
    ]);
    const result = flattenKitMembersInGraph("kit-a", graph);
    expect(result.prompts).toEqual(["prompt-1"]);
    expect(result.skills).toEqual(["skill-1"]);
  });

  it("nested kit is expanded — leaf order preserved DFS", () => {
    // kit-a → [kit-b (pos 0), prompt-1 (pos 1)]
    // kit-b → [skill-1 (pos 0), prompt-2 (pos 1)]
    const graph = new Map([
      [
        "kit-a",
        [
          { id: "kit-b", kind: "kit", position: 0 },
          { id: "prompt-1", kind: "prompt", position: 1 },
        ],
      ],
      [
        "kit-b",
        [
          { id: "skill-1", kind: "skill", position: 0 },
          { id: "prompt-2", kind: "prompt", position: 1 },
        ],
      ],
    ]);
    const result = flattenKitMembersInGraph("kit-a", graph);
    // DFS: kit-b first → skill-1, prompt-2; then prompt-1
    expect(result.skills).toEqual(["skill-1"]);
    expect(result.prompts).toEqual(["prompt-2", "prompt-1"]);
  });

  it("deduplicates shared members across branches", () => {
    // kit-a → [kit-b (pos 0), kit-c (pos 1)]
    // kit-b → [prompt-shared (pos 0)]
    // kit-c → [prompt-shared (pos 0), skill-1 (pos 1)]
    const graph = new Map([
      [
        "kit-a",
        [
          { id: "kit-b", kind: "kit", position: 0 },
          { id: "kit-c", kind: "kit", position: 1 },
        ],
      ],
      ["kit-b", [{ id: "prompt-shared", kind: "prompt", position: 0 }]],
      [
        "kit-c",
        [
          { id: "prompt-shared", kind: "prompt", position: 0 },
          { id: "skill-1", kind: "skill", position: 1 },
        ],
      ],
    ]);
    const result = flattenKitMembersInGraph("kit-a", graph);
    // prompt-shared appears only once
    expect(result.prompts).toEqual(["prompt-shared"]);
    expect(result.skills).toEqual(["skill-1"]);
  });

  it("cycle-safe — already-visited kit not re-expanded", () => {
    // This scenario shouldn't occur in practice (cycle check at write time),
    // but the flatten function must not infinite-loop if it does.
    const graph = new Map([
      ["kit-a", [{ id: "kit-b", kind: "kit", position: 0 }]],
      [
        "kit-b",
        [
          { id: "kit-a", kind: "kit", position: 0 }, // synthetic cycle
          { id: "prompt-1", kind: "prompt", position: 1 },
        ],
      ],
    ]);
    const result = flattenKitMembersInGraph("kit-a", graph);
    expect(result.prompts).toEqual(["prompt-1"]);
  });

  it("respects position order within a kit", () => {
    const graph = new Map([
      [
        "kit-a",
        [
          { id: "skill-z", kind: "skill", position: 10 },
          { id: "skill-a", kind: "skill", position: 1 },
          { id: "skill-m", kind: "skill", position: 5 },
        ],
      ],
    ]);
    const result = flattenKitMembersInGraph("kit-a", graph);
    expect(result.skills).toEqual(["skill-a", "skill-m", "skill-z"]);
  });
});
