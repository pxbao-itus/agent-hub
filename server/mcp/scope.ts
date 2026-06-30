import { z } from "zod";
import type { GroupRef } from "@/server/auth/access";

// ── Types ─────────────────────────────────────────────────────────────────────

export const tokenScopeSchema = z.object({
  spaces: z
    .array(
      z.object({
        groupType: z.enum(["org", "department", "team"]),
        groupId: z.string().uuid(),
      }),
    )
    .optional(),
  tags: z.array(z.string()).optional(),
  /** Allow write operations (e.g. update_task_status). Default false — read-only. */
  write: z.boolean().optional(),
});

export type TokenScope = z.infer<typeof tokenScopeSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse raw jsonb from DB into a validated scope. Returns null-scope (full access) on invalid/empty. */
export function parseScope(raw: unknown): TokenScope {
  const result = tokenScopeSchema.safeParse(raw);
  if (!result.success) return {};
  return result.data;
}

/**
 * Build Drizzle-compatible extra WHERE conditions for scope filtering.
 * Returns a set of owner ids allowed by the scope (intersected with user access).
 * Caller is responsible for the final inArray filter.
 */
export function applyScopeToOwners(
  scope: TokenScope,
  accessibleGroups: GroupRef[],
): GroupRef[] {
  if (!scope.spaces?.length) {
    // No space restriction — all accessible groups are allowed
    return accessibleGroups;
  }

  // Intersect: accessible ∩ scope.spaces
  const scopeSet = new Set(scope.spaces.map((s) => `${s.groupType}:${s.groupId}`));
  return accessibleGroups.filter((g) => scopeSet.has(`${g.groupType}:${g.groupId}`));
}

/**
 * Whether a prompt's tags overlap with the scope tag list.
 * Returns true when scope has no tag restriction, or when at least one tag matches.
 */
export function promptPassesScopeTags(tags: string[], scope: TokenScope): boolean {
  if (!scope.tags?.length) return true;
  const allowed = new Set(scope.tags);
  return tags.some((t) => allowed.has(t));
}

/** Validate that every space in the requested scope is within the user's accessible groups. */
export function validateScopeAgainstAccess(scope: TokenScope, accessibleGroups: GroupRef[]): boolean {
  if (!scope.spaces?.length) return true;
  const accessibleSet = new Set(accessibleGroups.map((g) => `${g.groupType}:${g.groupId}`));
  return scope.spaces.every((s) => accessibleSet.has(`${s.groupType}:${s.groupId}`));
}
