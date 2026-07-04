import { inArray } from "drizzle-orm";
import type { DbClient } from "@/server/db/types";
import { orgs, departments, teams } from "@/server/db/schema";
import { getCachedSlugPaths } from "@/server/lib/slug-path-cache";

/**
 * Resolves a list of prompt owners to their hierarchical slug paths.
 * Returns a map keyed by `"${ownerType}:${ownerId}"`.
 *
 * user       → ""
 * org        → "acme"
 * department → "acme.engineering"
 * team       → "acme.engineering.backend"
 *
 * Falls back to the first 8 chars of the ID if an entity has no slug.
 * Results are cached process-wide (slug-path-cache.ts) — only owners not
 * already cached hit the DB, at most 3 batched queries for that remainder.
 */
export async function resolveOwnerSlugPaths(
  owners: Array<{ ownerType: string; ownerId: string }>,
  db: DbClient,
): Promise<Map<string, string>> {
  const cache = getCachedSlugPaths();
  const result = new Map<string, string>();
  const uncached: Array<{ ownerType: string; ownerId: string }> = [];

  for (const o of owners) {
    const key = `${o.ownerType}:${o.ownerId}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      result.set(key, hit);
    } else {
      uncached.push(o);
    }
  }

  if (uncached.length > 0) {
    const computed = await computeOwnerSlugPaths(uncached, db);
    for (const [key, path] of computed) {
      cache.set(key, path);
      result.set(key, path);
    }
  }

  return result;
}

/** Uncached DB lookup — the actual 3-batched-query resolution. */
async function computeOwnerSlugPaths(
  owners: Array<{ ownerType: string; ownerId: string }>,
  db: DbClient,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  const directOrgIds = new Set(owners.filter((o) => o.ownerType === "org").map((o) => o.ownerId));
  const directDeptIds = new Set(owners.filter((o) => o.ownerType === "department").map((o) => o.ownerId));
  const directTeamIds = new Set(owners.filter((o) => o.ownerType === "team").map((o) => o.ownerId));

  for (const o of owners.filter((o) => o.ownerType === "user")) {
    result.set(`user:${o.ownerId}`, "");
  }
  if (!directOrgIds.size && !directDeptIds.size && !directTeamIds.size) return result;

  // Fetch teams first (need their departmentId to pull parent depts)
  const teamMap = new Map<string, { slug: string | null; departmentId: string }>();
  if (directTeamIds.size) {
    const rows = await db
      .select({ id: teams.id, slug: teams.slug, departmentId: teams.departmentId })
      .from(teams)
      .where(inArray(teams.id, [...directTeamIds]));
    for (const r of rows) teamMap.set(r.id, r);
  }

  // Collect all dept IDs needed (direct + parents of teams)
  const allDeptIds = new Set([
    ...directDeptIds,
    ...[...teamMap.values()].map((t) => t.departmentId),
  ]);

  // Fetch depts
  const deptMap = new Map<string, { slug: string | null; orgId: string }>();
  if (allDeptIds.size) {
    const rows = await db
      .select({ id: departments.id, slug: departments.slug, orgId: departments.orgId })
      .from(departments)
      .where(inArray(departments.id, [...allDeptIds]));
    for (const r of rows) deptMap.set(r.id, { slug: r.slug, orgId: r.orgId });
  }

  // Collect all org IDs needed (direct + parents of depts/teams)
  const allOrgIds = new Set([...directOrgIds, ...[...deptMap.values()].map((d) => d.orgId)]);

  // Fetch orgs
  const orgMap = new Map<string, string>(); // id → slug
  if (allOrgIds.size) {
    const rows = await db
      .select({ id: orgs.id, slug: orgs.slug })
      .from(orgs)
      .where(inArray(orgs.id, [...allOrgIds]));
    for (const r of rows) orgMap.set(r.id, r.slug);
  }

  // Build paths
  for (const id of directOrgIds) {
    result.set(`org:${id}`, orgMap.get(id) ?? id.slice(0, 8));
  }
  for (const id of directDeptIds) {
    const dept = deptMap.get(id);
    if (!dept) continue;
    const orgSlug = orgMap.get(dept.orgId) ?? dept.orgId.slice(0, 8);
    const deptSlug = dept.slug ?? id.slice(0, 8);
    result.set(`department:${id}`, `${orgSlug}.${deptSlug}`);
  }
  for (const id of directTeamIds) {
    const team = teamMap.get(id);
    if (!team) continue;
    const dept = deptMap.get(team.departmentId);
    const orgId = dept?.orgId ?? "";
    const orgSlug = orgMap.get(orgId) ?? orgId.slice(0, 8);
    const deptSlug = dept?.slug ?? team.departmentId.slice(0, 8);
    const teamSlug = team.slug ?? id.slice(0, 8);
    result.set(`team:${id}`, `${orgSlug}.${deptSlug}.${teamSlug}`);
  }

  return result;
}
