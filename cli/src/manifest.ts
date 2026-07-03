import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ManifestEntry = { versionNo: number; contentHash: string };

export type Manifest = {
  skills: Record<string, ManifestEntry>;
  kits: Record<string, ManifestEntry>;
  commands: Record<string, ManifestEntry>;
};

const MANIFEST_FILENAME = ".agent-hub-lock.json";

function emptyManifest(): Manifest {
  return { skills: {}, kits: {}, commands: {} };
}

export async function loadManifest(rootDir = process.cwd()): Promise<Manifest> {
  try {
    const raw = await readFile(join(rootDir, MANIFEST_FILENAME), "utf8");
    return { ...emptyManifest(), ...(JSON.parse(raw) as Partial<Manifest>) };
  } catch {
    return emptyManifest();
  }
}

export async function saveManifest(manifest: Manifest, rootDir = process.cwd()): Promise<void> {
  await writeFile(join(rootDir, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
