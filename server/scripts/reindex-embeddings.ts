/**
 * Inspect or purge stored embeddings by embedder id.
 *
 * Vectors are keyed by (artifact_version_id, embedder_id). Switching the active
 * embedder (e.g. local "bge-m3" → remote "bge-m3-remote") leaves the old
 * vectors behind; the reconciler only ever *adds* rows for the active embedder.
 * Use this to see what's stored and to drop a stale embedder's rows. After a
 * purge, the reconciler backfills the active embedder on its next tick if any
 * versions are missing.
 *
 * Usage:
 *   pnpm exec tsx server/scripts/reindex-embeddings.ts            # list
 *   pnpm exec tsx server/scripts/reindex-embeddings.ts --list
 *   pnpm exec tsx server/scripts/reindex-embeddings.ts --purge bge-m3
 *   — or via Makefile: make db/reindex   /   make db/reindex purge=bge-m3
 *
 * NOTE: the embedding column is a fixed vector(1024) with an HNSW index.
 * Switching to a model with different dimensions needs a schema migration
 * (new column/index), not just a purge + re-embed.
 */

import "dotenv/config";
import { sql, eq } from "drizzle-orm";
import { db } from "../db";
import { artifactEmbeddings } from "../db/schema";

async function list() {
  const rows = await db
    .select({
      embedderId: artifactEmbeddings.embedderId,
      dimensions: artifactEmbeddings.dimensions,
      count: sql<number>`count(*)::int`,
    })
    .from(artifactEmbeddings)
    .groupBy(artifactEmbeddings.embedderId, artifactEmbeddings.dimensions);

  if (!rows.length) {
    console.log("No embeddings stored.");
    return;
  }
  console.log("Stored embeddings:");
  for (const r of rows) {
    console.log(`  ${r.embedderId}  (dim ${r.dimensions})  → ${r.count} row(s)`);
  }
}

async function purge(embedderId: string) {
  const deleted = await db
    .delete(artifactEmbeddings)
    .where(eq(artifactEmbeddings.embedderId, embedderId))
    .returning({ id: artifactEmbeddings.id });
  console.log(`Purged ${deleted.length} row(s) for embedder "${embedderId}".`);
}

const args = process.argv.slice(2);
const purgeIdx = args.indexOf("--purge");

if (purgeIdx !== -1) {
  const id = args[purgeIdx + 1];
  if (!id) {
    console.error("Error: --purge requires an embedder id, e.g. --purge bge-m3");
    process.exit(1);
  }
  await purge(id);
} else {
  await list();
}

process.exit(0);
