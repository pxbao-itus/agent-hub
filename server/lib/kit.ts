import { eq, inArray } from "drizzle-orm";
import { artifacts, artifactMembers } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";

export type MemberRow = {
  id: string;
  kind: string;
  title: string;
  slug: string | null;
  description: string | null;
  ownerType: string;
  ownerId: string;
};

export type FlattenResult = {
  prompts: MemberRow[];
  skills: MemberRow[];
};

// ── Pure graph algorithms (testable without DB) ───────────────────────────────

/**
 * Pure cycle check over an in-memory graph.
 * `graph` maps kitId → list of direct member artifact ids (any kind).
 * `kitIds` is the set of which artifact ids are kits (only kits can recurse).
 */
export function wouldCreateCycleInGraph(
  kitId: string,
  candidateId: string,
  graph: Map<string, string[]>,
  kitIds: Set<string>,
): boolean {
  if (candidateId === kitId) return true;
  if (!kitIds.has(candidateId)) return false; // leaf — can't create cycle

  const visited = new Set<string>();
  const queue: string[] = [candidateId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const members = graph.get(current) ?? [];
    for (const memberId of members) {
      if (memberId === kitId) return true;
      if (kitIds.has(memberId) && !visited.has(memberId)) {
        queue.push(memberId);
      }
    }
  }

  return false;
}

/**
 * Pure flatten over an in-memory graph.
 * Returns leaf prompts and skills in DFS position order, deduplicated.
 */
export function flattenKitMembersInGraph(
  kitId: string,
  graph: Map<string, { id: string; kind: string; position: number }[]>,
): { prompts: string[]; skills: string[] } {
  const prompts: string[] = [];
  const skills: string[] = [];
  const seen = new Set<string>();

  function visit(id: string): void {
    if (seen.has(id)) return;
    seen.add(id);

    const members = (graph.get(id) ?? []).slice().sort((a, b) => a.position - b.position);
    for (const m of members) {
      if (seen.has(m.id)) continue;
      if (m.kind === "kit") {
        visit(m.id);
      } else if (m.kind === "prompt") {
        seen.add(m.id);
        prompts.push(m.id);
      } else if (m.kind === "skill") {
        seen.add(m.id);
        skills.push(m.id);
      }
    }
  }

  visit(kitId);
  return { prompts, skills };
}

// ── DB-backed public API ──────────────────────────────────────────────────────

/**
 * Return true if adding `candidateId` as a member of `kitId` would create a cycle.
 */
export async function wouldCreateCycle(
  kitId: string,
  candidateId: string,
  db: DbClient,
): Promise<boolean> {
  if (candidateId === kitId) return true;

  // Check if candidate is a kit at all
  const candidateRow = await db
    .select({ kind: artifacts.kind })
    .from(artifacts)
    .where(eq(artifacts.id, candidateId))
    .then((r) => r[0]);

  if (!candidateRow || candidateRow.kind !== "kit") return false;

  // BFS: build graph on-the-fly level by level
  const kitIdsToExpand = new Set<string>([candidateId]);
  const graph = new Map<string, string[]>();
  const kitIdSet = new Set<string>([candidateId]);
  const visited = new Set<string>();

  while (kitIdsToExpand.size > 0) {
    const batch = [...kitIdsToExpand];
    kitIdsToExpand.clear();
    batch.forEach((id) => visited.add(id));

    const members = await db
      .select({
        kitArtifactId: artifactMembers.kitArtifactId,
        memberArtifactId: artifactMembers.memberArtifactId,
      })
      .from(artifactMembers)
      .where(inArray(artifactMembers.kitArtifactId, batch));

    const memberIds = [...new Set(members.map((m) => m.memberArtifactId))];
    if (!memberIds.length) continue;

    const artifactRows = await db
      .select({ id: artifacts.id, kind: artifacts.kind })
      .from(artifacts)
      .where(inArray(artifacts.id, memberIds));

    const kindById = new Map(artifactRows.map((r) => [r.id, r.kind]));

    for (const m of members) {
      if (m.memberArtifactId === kitId) return true;
      const existing = graph.get(m.kitArtifactId) ?? [];
      existing.push(m.memberArtifactId);
      graph.set(m.kitArtifactId, existing);

      const kind = kindById.get(m.memberArtifactId);
      if (kind === "kit") {
        kitIdSet.add(m.memberArtifactId);
        if (!visited.has(m.memberArtifactId)) kitIdsToExpand.add(m.memberArtifactId);
      }
    }
  }

  return false;
}

/**
 * Flatten all leaf members (prompt | skill) of `kitId` recursively.
 * Kit members are expanded; their children are included instead.
 * Results are deduplicated and returned in DFS position order.
 *
 * @param accessibleIds  Optional allowlist — members not in this set are skipped.
 */
export async function flattenKitMembers(
  kitId: string,
  db: DbClient,
  accessibleIds?: Set<string>,
): Promise<FlattenResult> {
  const prompts: MemberRow[] = [];
  const skills: MemberRow[] = [];
  const seen = new Set<string>([kitId]);

  async function visit(id: string): Promise<void> {
    const memberRows = await db
      .select({
        memberArtifactId: artifactMembers.memberArtifactId,
        position: artifactMembers.position,
      })
      .from(artifactMembers)
      .where(eq(artifactMembers.kitArtifactId, id))
      .then((r) => r.sort((a, b) => a.position - b.position));

    if (!memberRows.length) return;

    const memberIds = memberRows.map((m) => m.memberArtifactId);
    const artifactRows = await db
      .select({
        id: artifacts.id,
        kind: artifacts.kind,
        title: artifacts.title,
        slug: artifacts.slug,
        description: artifacts.description,
        ownerType: artifacts.ownerType,
        ownerId: artifacts.ownerId,
      })
      .from(artifacts)
      .where(inArray(artifacts.id, memberIds));

    const byId = new Map(artifactRows.map((r) => [r.id, r]));

    for (const { memberArtifactId } of memberRows) {
      if (seen.has(memberArtifactId)) continue;
      const row = byId.get(memberArtifactId);
      if (!row) continue;
      if (accessibleIds && !accessibleIds.has(row.id)) continue;

      if (row.kind === "kit") {
        seen.add(row.id);
        await visit(row.id);
      } else if (row.kind === "prompt") {
        seen.add(row.id);
        prompts.push(row);
      } else if (row.kind === "skill") {
        seen.add(row.id);
        skills.push(row);
      }
    }
  }

  await visit(kitId);
  return { prompts, skills };
}
