import type { Embedder } from "@/server/embedder";

/**
 * Process-wide cache of query embeddings, keyed by `${embedderId}:${normalizedQuery}`.
 * Same globalThis-Map pattern as version-cache.ts (D-018) — no framework
 * cache API, so it behaves identically in tests, dev, and prod.
 *
 * Unlike version-cache.ts (key = immutable version id, safe to grow
 * unbounded), the key here is free-text search input — unbounded in
 * practice — so this cache is capped with simple FIFO eviction (Map
 * preserves insertion order) rather than kept forever.
 */
const MAX_ENTRIES = 500;

const g = globalThis as unknown as { __queryEmbeddingCache?: Map<string, number[]> };
if (!g.__queryEmbeddingCache) g.__queryEmbeddingCache = new Map();

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Returns the embedding for `query`, computing + caching it on a miss. */
export async function getCachedQueryEmbedding(query: string, embedder: Embedder): Promise<number[]> {
  const cache = g.__queryEmbeddingCache!;
  const key = `${embedder.embedderId}:${normalizeQuery(query)}`;

  const hit = cache.get(key);
  if (hit) return hit;

  const [vec] = await embedder.embed([query]);

  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, vec);
  return vec;
}
