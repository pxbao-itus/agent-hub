/**
 * Pluggable embedding interface.
 *
 * Switch implementation via EMBEDDER env var (null | local | remote).
 * Default: NullEmbedder (no-op). Set EMBEDDER=local to use bge-m3 locally,
 * or EMBEDDER=remote + EMBEDDER_URL to call a self-hosted TEI server.
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

let _instance: Embedder = new NullEmbedder();

/** Returns the current singleton Embedder. Always synchronous. */
export function getEmbedder(): Embedder {
  return _instance;
}

/**
 * Register the embedder for this process. Called once from instrumentation.ts
 * before any requests are served. Safe to call multiple times (last write wins).
 */
export function setEmbedder(e: Embedder): void {
  _instance = e;
}
