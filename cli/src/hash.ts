import { createHash } from "node:crypto";

/** Deterministic content hash for a skill/prompt's body + bundled files, used to detect local edits (§5, plans/42-cli-filesystem-sync.md). */
export function hashContent(body: string, files: { path: string; content: string }[] = []): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const hash = createHash("sha256");
  hash.update(`body\0${body}`);
  for (const f of sorted) hash.update(`\0file\0${f.path}\0${f.content}`);
  return hash.digest("hex");
}
