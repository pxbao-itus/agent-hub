import { eq, and, isNull, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { prompts, promptVersions, promptEmbeddings } from "@/server/db/schema";
import { getEmbedder } from "./index";

const BATCH = 10;
const INTERVAL_MS = 5_000;

let running = false;

async function tick() {
  const embedder = getEmbedder();
  if (embedder.embedderId === "null") return;

  // Find prompt versions that have no embedding for the current model.
  // LEFT JOIN: rows where promptEmbeddings.id IS NULL have no embedding yet.
  const pending = await db
    .select({
      versionId: promptVersions.id,
      body: promptVersions.body,
      promptId: promptVersions.promptId,
    })
    .from(promptVersions)
    .leftJoin(
      promptEmbeddings,
      and(
        eq(promptEmbeddings.promptVersionId, promptVersions.id),
        eq(promptEmbeddings.embedderId, embedder.embedderId),
      ),
    )
    .where(isNull(promptEmbeddings.id))
    .limit(BATCH);

  if (!pending.length) return;

  // Fetch prompt metadata (title + description) to enrich the embedding text.
  const promptIds = [...new Set(pending.map((r) => r.promptId))];
  const promptMeta = await db
    .select({ id: prompts.id, title: prompts.title, description: prompts.description })
    .from(prompts)
    .where(inArray(prompts.id, promptIds));
  const metaMap = new Map(promptMeta.map((p) => [p.id, p]));

  const texts = pending.map((v) => {
    const meta = metaMap.get(v.promptId);
    return [meta?.title, meta?.description, v.body].filter(Boolean).join("\n\n");
  });

  const vectors = await embedder.embed(texts);

  // Unique constraint (prompt_version_id, embedder_id) makes this idempotent.
  await db
    .insert(promptEmbeddings)
    .values(
      pending.map((v, i) => ({
        promptVersionId: v.versionId,
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
