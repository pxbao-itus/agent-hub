import type { Embedder } from "./index";

/**
 * Deterministic embedder for tests: the same text always maps to the same
 * unit vector, with no network or model dependency. NOT semantically
 * meaningful — an exact-text match will rank first (distance 0), but
 * unrelated texts have no meaningful similarity relationship. Use only to
 * exercise the vector/RRF plumbing in functional e2e and integration tests;
 * evaluate real search quality against LocalEmbedder/RemoteEmbedder instead.
 */
export class StubEmbedder implements Embedder {
  readonly embedderId = "stub";
  readonly dimensions = 1024;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vectorFor(t));
  }

  private vectorFor(text: string): number[] {
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
      seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
    }
    if (seed === 0) seed = 1;

    const vec = new Array<number>(this.dimensions);
    for (let i = 0; i < this.dimensions; i++) {
      // xorshift32 — cheap deterministic PRNG, good enough for test fixtures.
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      vec[i] = (seed / 0xffffffff) * 2 - 1;
    }

    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}
