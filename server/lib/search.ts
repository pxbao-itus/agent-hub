import { and, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { DbClient } from "@/server/db/types";
import { artifacts, artifactVersions, artifactEmbeddings } from "@/server/db/schema";
import type { Embedder } from "@/server/embedder";
import { getCachedQueryEmbedding } from "@/server/lib/query-embedding-cache";

const FTS_POOL = 50;
const VEC_POOL = 50;

/**
 * Pure Reciprocal Rank Fusion. Each input list is ordered best-first.
 * Returns merged IDs ordered best-first.
 * k=60 is the standard RRF constant.
 */
export function rrfMerge(rankedLists: string[][], k = 60): string[] {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

/** Run FTS, return IDs ordered by ts_rank DESC. */
async function runFts(
  query: string,
  accessCondition: SQL | undefined,
  tagFilter: SQL | undefined,
  dbClient: DbClient,
): Promise<string[]> {
  const tsvec = sql`to_tsvector('english', ${artifacts.title} || ' ' || coalesce(${artifacts.description}, ''))`;
  const tsquery = sql`plainto_tsquery('english', ${query})`;

  const rows = await dbClient
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(and(accessCondition, tagFilter, sql`${tsvec} @@ ${tsquery}`))
    .orderBy(sql`ts_rank(${tsvec}, ${tsquery}) DESC`)
    .limit(FTS_POOL);

  return rows.map((r) => r.id);
}

/** Run cosine vector search, return IDs ordered by similarity DESC. */
async function runVectorSearch(
  queryVec: number[],
  embedder: Embedder,
  accessCondition: SQL | undefined,
  tagFilter: SQL | undefined,
  dbClient: DbClient,
): Promise<string[]> {
  // Format as pgvector literal: [0.1,0.2,...,0.3]
  const vecLiteral = `[${queryVec.map((n) => n.toFixed(6)).join(",")}]`;

  const rows = await dbClient
    .select({ id: artifacts.id })
    .from(artifacts)
    .innerJoin(
      artifactVersions,
      and(
        eq(artifactVersions.id, artifacts.currentVersionId!),
        isNotNull(artifacts.currentVersionId),
      ),
    )
    .innerJoin(
      artifactEmbeddings,
      and(
        eq(artifactEmbeddings.artifactVersionId, artifactVersions.id),
        eq(artifactEmbeddings.embedderId, embedder.embedderId),
      ),
    )
    .where(and(accessCondition, tagFilter))
    .orderBy(sql`${artifactEmbeddings.embedding} <=> ${vecLiteral}::vector`)
    .limit(VEC_POOL);

  return rows.map((r) => r.id);
}

export interface HybridSearchResult {
  ids: string[];
  mode: "hybrid" | "keyword";
}

/**
 * Hybrid search: FTS + vector cosine via RRF.
 * Falls back to keyword-only when the embedder is null.
 */
export async function hybridSearch(opts: {
  query: string;
  accessCondition: SQL | undefined;
  tagFilter?: SQL | undefined;
  embedder: Embedder;
  db: DbClient;
  limit: number;
  offset: number;
}): Promise<HybridSearchResult> {
  const { query, accessCondition, tagFilter, embedder, db: dbClient, limit, offset } = opts;
  const semantic = embedder.embedderId !== "null";

  if (!semantic) {
    // Keyword-only fallback
    const ids = await runFts(query, accessCondition, tagFilter, dbClient);
    return { ids: ids.slice(offset, offset + limit), mode: "keyword" };
  }

  // Embed query + run FTS in parallel
  const [queryVec, ftsIds] = await Promise.all([
    getCachedQueryEmbedding(query, embedder),
    runFts(query, accessCondition, tagFilter, dbClient),
  ]);

  const vecIds = await runVectorSearch(queryVec, embedder, accessCondition, tagFilter, dbClient);
  const merged = rrfMerge([ftsIds, vecIds]);

  return { ids: merged.slice(offset, offset + limit), mode: "hybrid" };
}

/** Fetch full artifact rows for the given IDs, preserving the provided order. */
export async function fetchArtifactsByIds(ids: string[], dbClient: DbClient) {
  if (!ids.length) return [];
  const rows = await dbClient.query.artifacts.findMany({
    where: inArray(artifacts.id, ids),
    with: { versions: { limit: 1, orderBy: sql`version_no DESC` } },
  });
  const map = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => map.get(id)).filter(Boolean) as typeof rows;
}

/**
 * Re-sort already-fetched search results for list pages. "relevant" keeps
 * hybridSearch's RRF order as-is (a no-op); "recent"/"title" override it.
 */
export function sortArtifactRows<T extends { updatedAt: Date | string; title: string }>(
  rows: T[],
  sort: string,
): T[] {
  if (sort === "recent") {
    return [...rows].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }
  if (sort === "title") {
    return [...rows].sort((a, b) => a.title.localeCompare(b.title));
  }
  return rows;
}
