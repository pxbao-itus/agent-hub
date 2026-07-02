import { eq } from "drizzle-orm";
import type { DbClient } from "@/server/db/types";
import { artifactVersions } from "@/server/db/schema";

export type VersionContent = {
  body: string;
  files: { path: string; content: string; mimeType: string | null }[];
};

/**
 * Process-wide cache of version body + bundled files, keyed by the
 * immutable version id (each save creates a new version — see
 * plans/data-model.md — so an existing key's value never changes and never
 * needs invalidation, only a fresh miss when a new version is created).
 *
 * Deliberately a plain in-memory Map on globalThis, not Next's
 * `unstable_cache` — that throws ("incrementalCache missing") outside a
 * running Next.js server, which would break every *.itest.ts that calls
 * createMcpServer() directly under plain Vitest (Phase 39 finding). Same
 * globalThis-singleton pattern already used for the DB pool and the
 * embedder instance (see server/db/index.ts, server/embedder/index.ts —
 * D-018), for the same reason: needs to behave identically in tests, dev,
 * and prod.
 */
const g = globalThis as unknown as { __versionContentCache?: Map<string, VersionContent> };
if (!g.__versionContentCache) g.__versionContentCache = new Map();

export async function getCachedVersionContent(
  versionId: string,
  db: DbClient,
): Promise<VersionContent | null> {
  const cache = g.__versionContentCache!;
  const hit = cache.get(versionId);
  if (hit) return hit;

  const version = await db.query.artifactVersions.findFirst({
    where: eq(artifactVersions.id, versionId),
    with: { files: true },
  });
  if (!version) return null;

  const content: VersionContent = {
    body: version.body,
    files: version.files.map((f) => ({ path: f.path, content: f.content, mimeType: f.mimeType })),
  };
  cache.set(versionId, content);
  return content;
}
