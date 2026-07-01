import type { Embedder } from "./index";

/**
 * Remote embedder backed by a self-hosted HuggingFace Text Embeddings
 * Inference (TEI) server serving bge-m3 (see deployment/llm/).
 *
 * Distinct embedderId from LocalEmbedder ("bge-m3-remote" vs "bge-m3") so the
 * reconciler (which keys off embedderId) treats this as a separate index and
 * (re-)embeds via this runtime instead of assuming vectors produced by a
 * different embedder implementation are equivalent.
 */
export class RemoteEmbedder implements Embedder {
  readonly embedderId = "bge-m3-remote";
  readonly dimensions = 1024;

  /**
   * @param baseUrl base URL of the TEI server (or the reverse-proxy in front of it).
   * @param token   optional bearer token; when set, sent as `Authorization: Bearer <token>`
   *                so a token-gating proxy in front of TEI accepts the request.
   */
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const res = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/embed`, {
      method: "POST",
      headers,
      body: JSON.stringify({ inputs: texts }),
    });

    if (!res.ok) {
      throw new Error(`RemoteEmbedder: TEI request failed (${res.status}): ${await res.text()}`);
    }

    return (await res.json()) as number[][];
  }
}
