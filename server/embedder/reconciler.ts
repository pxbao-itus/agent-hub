import { eq, and, isNull, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { artifacts, artifactVersions, artifactEmbeddings } from "@/server/db/schema";
import { getEmbedder } from "./index";

const BATCH = 10;
const INTERVAL_MS = 5_000;

let running = false;

async function tick() {
  const embedder = getEmbedder();
  if (embedder.embedderId === "null") return;

  // Find artifact versions that have no embedding for the current model.
  // LEFT JOIN: rows where artifactEmbeddings.id IS NULL have no embedding yet.
  const pending = await db
    .select({
      versionId: artifactVersions.id,
      body: artifactVersions.body,
      artifactId: artifactVersions.artifactId,
    })
    .from(artifactVersions)
    .leftJoin(
      artifactEmbeddings,
      and(
        eq(artifactEmbeddings.artifactVersionId, artifactVersions.id),
        eq(artifactEmbeddings.embedderId, embedder.embedderId),
      ),
    )
    .where(isNull(artifactEmbeddings.id))
    .limit(BATCH);

  if (!pending.length) return;

  // Fetch artifact metadata (title + description) to enrich the embedding text.
  const artifactIds = [...new Set(pending.map((r) => r.artifactId))];
  const artifactMeta = await db
    .select({ id: artifacts.id, title: artifacts.title, description: artifacts.description })
    .from(artifacts)
    .where(inArray(artifacts.id, artifactIds));
  const metaMap = new Map(artifactMeta.map((p) => [p.id, p]));

  const texts = pending.map((v) => {
    const meta = metaMap.get(v.artifactId);
    return [meta?.title, meta?.description, v.body].filter(Boolean).join("\n\n");
  });

  const vectors = await embedder.embed(texts);

  // Unique constraint (artifact_version_id, embedder_id) makes this idempotent.
  await db
    .insert(artifactEmbeddings)
    .values(
      pending.map((v, i) => ({
        artifactVersionId: v.versionId,
        embedderId: embedder.embedderId,
        dimensions: embedder.dimensions,
        embedding: vectors[i],
      })),
    )
    .onConflictDoNothing();

  console.log(`[reconciler] embedded ${pending.length} version(s)`);
}

export function startReconciler(): void {
  if (running) return;
  running = true;

  (async () => {
    console.log("[reconciler] started");
    while (running) {
      try {
        await tick();
      } catch (err) {
        console.error("[reconciler] tick error:", err);
      }
      await new Promise<void>((r) => setTimeout(r, INTERVAL_MS));
    }
  })().catch(console.error);
}

export function stopReconciler(): void {
  running = false;
}
