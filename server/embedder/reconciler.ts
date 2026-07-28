import { eq, and, isNull, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import {
  artifacts,
  artifactVersions,
  artifactEmbeddings,
  artifactFiles,
  artifactTasks,
} from "@/server/db/schema";
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

  // Fetch artifact metadata (title + description + kind) to enrich the embedding text.
  const artifactIds = [...new Set(pending.map((r) => r.artifactId))];
  const artifactMeta = await db
    .select({ id: artifacts.id, title: artifacts.title, description: artifacts.description, kind: artifacts.kind })
    .from(artifacts)
    .where(inArray(artifacts.id, artifactIds));
  const metaMap = new Map(artifactMeta.map((p) => [p.id, p]));

  // Kind-specific extra text so the vector captures more than just the body:
  // skill → bundled file paths (per version), plan → task content.
  const versionIds = pending.map((v) => v.versionId);
  const skillFiles = await db
    .select({ artifactVersionId: artifactFiles.artifactVersionId, path: artifactFiles.path })
    .from(artifactFiles)
    .where(inArray(artifactFiles.artifactVersionId, versionIds));
  const filesByVersion = new Map<string, string[]>();
  for (const f of skillFiles) {
    const list = filesByVersion.get(f.artifactVersionId) ?? [];
    list.push(f.path);
    filesByVersion.set(f.artifactVersionId, list);
  }

  const planTasks = await db
    .select({ artifactId: artifactTasks.artifactId, content: artifactTasks.content })
    .from(artifactTasks)
    .where(inArray(artifactTasks.artifactId, artifactIds));
  const tasksByArtifact = new Map<string, string[]>();
  for (const t of planTasks) {
    const list = tasksByArtifact.get(t.artifactId) ?? [];
    list.push(t.content);
    tasksByArtifact.set(t.artifactId, list);
  }

  const texts = pending.map((v) => {
    const meta = metaMap.get(v.artifactId);
    const extra =
      meta?.kind === "skill" ? filesByVersion.get(v.versionId)?.join(", ")
      : meta?.kind === "plan" ? tasksByArtifact.get(v.artifactId)?.join("\n")
      : undefined;
    return [meta?.title, meta?.description, v.body, extra].filter(Boolean).join("\n\n");
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
