import type { ArtifactKind } from "@/server/db/schema";

/** Kind -> route segment is regular pluralization for all five kinds. */
export function artifactDetailPath(kind: ArtifactKind, id: string): string {
  return `/${kind}s/${id}`;
}
