import { describe, it, expect, beforeEach } from "vitest";
import { getCachedQueryEmbedding } from "./query-embedding-cache";
import type { Embedder } from "@/server/embedder";

function fakeEmbedder(embedderId = "fake"): Embedder & { calls: string[] } {
  return {
    embedderId,
    dimensions: 3,
    calls: [] as string[],
    async embed(texts: string[]) {
      this.calls.push(...texts);
      return texts.map((t) => [t.length, 0, 0]);
    },
  };
}

// Cache is a globalThis singleton — clear the module's require cache isn't
// possible mid-process, so each test uses a distinct embedderId/query to
// avoid cross-test pollution instead of resetting internal state.
let counter = 0;
beforeEach(() => {
  counter++;
});

describe("getCachedQueryEmbedding", () => {
  it("only calls embed() once for repeated identical queries", async () => {
    const embedder = fakeEmbedder(`fake-${counter}`);
    const v1 = await getCachedQueryEmbedding("hello world", embedder);
    const v2 = await getCachedQueryEmbedding("hello world", embedder);
    expect(embedder.calls).toHaveLength(1);
    expect(v2).toEqual(v1);
  });

  it("normalizes whitespace and case before keying", async () => {
    const embedder = fakeEmbedder(`fake-${counter}`);
    await getCachedQueryEmbedding("  Hello   World  ", embedder);
    await getCachedQueryEmbedding("hello world", embedder);
    expect(embedder.calls).toHaveLength(1);
  });

  it("keys by embedder id — different embedders never share a cache entry", async () => {
    const a = fakeEmbedder(`fake-a-${counter}`);
    const b = fakeEmbedder(`fake-b-${counter}`);
    await getCachedQueryEmbedding("same query", a);
    await getCachedQueryEmbedding("same query", b);
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
  });

  it("distinct queries each cause their own embed() call", async () => {
    const embedder = fakeEmbedder(`fake-${counter}`);
    await getCachedQueryEmbedding("first query", embedder);
    await getCachedQueryEmbedding("second query", embedder);
    expect(embedder.calls).toHaveLength(2);
  });
});
