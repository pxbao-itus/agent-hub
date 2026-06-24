import type { Embedder } from "./index";

/**
 * Local embedder backed by @huggingface/transformers (ONNX, bge-m3).
 *
 * ONNX Runtime runs on its own native thread pool, so awaiting embed()
 * does not block the Node.js event loop — no explicit worker_threads
 * wrapper is required.
 *
 * Model files are downloaded from HuggingFace Hub on first use and
 * cached in the directory specified by HF_HOME (default: ~/.cache/huggingface).
 * Mount that path as a Docker volume to avoid re-downloading on restart.
 */
export class LocalEmbedder implements Embedder {
  readonly embedderId = "bge-m3";
  readonly dimensions = 1024;

  // Lazily initialized: the Promise resolves to the loaded pipeline
  private pipelinePromise: Promise<(texts: string[], opts: Record<string, unknown>) => Promise<{ tolist(): number[][] }>> | null = null;

  private getOrLoadPipeline() {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        const { pipeline, env } = await import("@huggingface/transformers");
        if (process.env.HF_HOME) {
          env.cacheDir = process.env.HF_HOME;
        }
        return pipeline("feature-extraction", "Xenova/bge-m3", {
          dtype: "q8",
          device: "cpu",
        }) as Promise<(texts: string[], opts: Record<string, unknown>) => Promise<{ tolist(): number[][] }>>;
      })();
    }
    return this.pipelinePromise;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const pipe = await this.getOrLoadPipeline();
    const output = await pipe(texts, { pooling: "cls", normalize: true });
    return output.tolist();
  }
}
