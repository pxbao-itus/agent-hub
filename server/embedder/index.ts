/**
 * Pluggable embedding interface.
 *
 * Switch implementation via EMBEDDER env var (null | local | remote | stub).
 * Default: NullEmbedder (no-op). Set EMBEDDER=local to use bge-m3 locally,
 * EMBEDDER=remote + EMBEDDER_URL to call a self-hosted TEI server, or
 * EMBEDDER=stub for the deterministic test-only embedder (see stub.ts).
 *
 * Call setEmbedder() from instrumentation.ts at startup to register a real
 * implementation before the first request is handled.
 */

export interface Embedder {
  /** Model identifier stored alongside vectors so queries match the right index. */
  readonly embedderId: string;
  /** Dimensionality of vectors this embedder produces. */
  readonly dimensions: number;
  /** Embed one or more texts. Returns one float array per input. */
  embed(texts: string[]): Promise<number[][]>;
}

export class NullEmbedder implements Embedder {
  readonly embedderId = "null";
  readonly dimensions = 1024;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array<number>(this.dimensions).fill(0));
  }
}

// A plain module-level `let` here does NOT reliably share state between
// instrumentation.ts's register() and route/page code: confirmed by testing
// (both `next dev` and a clean `next start`/standalone build) that
// setEmbedder() from instrumentation.ts left every page-rendered search on
// keyword-only fallback despite EMBEDDER being set to local/remote/stub —
// instrumentation runs in a separate module realm from request handling.
// globalThis is a true process-wide object, immune to that split (same
// pattern already used for the DB pool in server/db/index.ts).
const g = globalThis as unknown as { __embedderInstance?: Embedder };
if (!g.__embedderInstance) g.__embedderInstance = new NullEmbedder();

/** Returns the current singleton Embedder. Always synchronous. */
export function getEmbedder(): Embedder {
  return g.__embedderInstance!;
}

/**
 * Register the embedder for this process. Called once from instrumentation.ts
 * before any requests are served. Safe to call multiple times (last write wins).
 */
export function setEmbedder(e: Embedder): void {
  g.__embedderInstance = e;
}
