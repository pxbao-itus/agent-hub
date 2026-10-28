/**
 * Process-wide cache of resolved owner slug paths, keyed by `${ownerType}:${ownerId}`.
 * Same globalThis-Map pattern as version-cache.ts.
 *
 * Unlike a version id, a group's slug path is NOT permanently immutable —
 * `department.update`/`team.update` accept a `slug` change, and that change
 * also invalidates every descendant team's cached path (a team's path
 * embeds its parent department's slug). Rather than compute the affected
 * descendant set on every rename (rare, admin-only operation), `clear()`
 * just drops the whole cache — correctness over micro-optimizing a path
 * that isn't hot.
 */
const g = globalThis as unknown as { __slugPathCache?: Map<string, string> };
if (!g.__slugPathCache) g.__slugPathCache = new Map();

export function getCachedSlugPaths(): Map<string, string> {
  return g.__slugPathCache!;
}

/** Call after any org/department/team slug change. */
export function clearSlugPathCache(): void {
  g.__slugPathCache!.clear();
}
