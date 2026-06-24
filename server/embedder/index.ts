/**
 * Pluggable embedding interface.
 *
 * Swap implementations via EMBEDDER env var without touching call sites.
 * Default: NullEmbedder (no-op, returns empty vectors) until v0.2.
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

let _instance: Embedder | null = null;

/** Returns the singleton Embedder for this process. */
export function getEmbedder(): Embedder {
  if (!_instance) _instance = new NullEmbedder();
  return _instance;
}
