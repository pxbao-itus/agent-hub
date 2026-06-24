import { eq, and, or, inArray, desc } from "drizzle-orm";
import type { DbClient } from "@/server/db/types";
import { prompts, promptVersions, orgs, departments, teams } from "@/server/db/schema";
import type { GroupRef } from "@/server/auth/access";

export type GroupPromptItem = {
  id: string;
  title: string;
  visibility: "private" | "group" | "public";
  tags: string[];
  ownerType: "org" | "department" | "team";
  ownerId: string;
  ownerName: string;
  preview: string;
};

type Owner = { type: "org" | "department" | "team"; id: string; name: string };

type FetchOptions = {
  root: { type: "org" | "department" | "team"; id: string };
  viewerIsAdmin: boolean;
  accessibleGroups: GroupRef[];
  db: DbClient;
};

export async function fetchSubtreePrompts({
  root,
  viewerIsAdmin,
  accessibleGroups,
  db,
}: FetchOptions): Promise<GroupPromptItem[]> {
  const owners: Owner[] = [];

  if (root.type === "org") {
    const org = await db.query.orgs.findFirst({ where: eq(orgs.id, root.id) });
    if (!org) return [];
    owners.push({ type: "org", id: root.id, name: org.name });

    const deptRows = await db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(eq(departments.orgId, root.id));
    for (const d of deptRows) owners.push({ type: "department", id: d.id, name: d.name });

    if (deptRows.length > 0) {
      const teamRows = await db
        .select({ id: teams.id, name: teams.name })
        .from(teams)
        .where(inArray(teams.departmentId, deptRows.map((d) => d.id)));
      for (const t of teamRows) owners.push({ type: "team", id: t.id, name: t.name });
    }
  } else if (root.type === "department") {
    const dept = await db.query.departments.findFirst({ where: eq(departments.id, root.id) });
    if (!dept) return [];
    owners.push({ type: "department", id: root.id, name: dept.name });

    const teamRows = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.departmentId, root.id));
    for (const t of teamRows) owners.push({ type: "team", id: t.id, name: t.name });
  } else {
    const team = await db.query.teams.findFirst({ where: eq(teams.id, root.id) });
    if (!team) return [];
    owners.push({ type: "team", id: root.id, name: team.name });
  }

  // Non-admin: keep only owners in the accessible set
  let visibleOwners = owners;
  if (!viewerIsAdmin) {
    const accessibleSet = new Set(
      accessibleGroups.map((g) => `${g.groupType}:${g.groupId}`),
    );
    visibleOwners = owners.filter((o) => accessibleSet.has(`${o.type}:${o.id}`));
  }

  if (visibleOwners.length === 0) return [];

  const orgIds = visibleOwners.filter((o) => o.type === "org").map((o) => o.id);
  const deptIds = visibleOwners.filter((o) => o.type === "department").map((o) => o.id);
  const teamIds = visibleOwners.filter((o) => o.type === "team").map((o) => o.id);

  const ownerClauses = [
    orgIds.length > 0
      ? and(eq(prompts.ownerType, "org"), inArray(prompts.ownerId, orgIds))
      : undefined,
    deptIds.length > 0
      ? and(eq(prompts.ownerType, "department"), inArray(prompts.ownerId, deptIds))
      : undefined,
    teamIds.length > 0
      ? and(eq(prompts.ownerType, "team"), inArray(prompts.ownerId, teamIds))
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => !!c);

  const visibilityClause = viewerIsAdmin
    ? undefined
    : or(eq(prompts.visibility, "group"), eq(prompts.visibility, "public"));

  const whereClause = and(or(...ownerClauses), visibilityClause);

  const rows = await db.query.prompts.findMany({
    where: whereClause,
    orderBy: desc(prompts.updatedAt),
    with: {
      versions: {
        limit: 1,
        orderBy: desc(promptVersions.versionNo),
        columns: { body: true },
      },
    },
  });

  const nameMap = new Map(visibleOwners.map((o) => [`${o.type}:${o.id}`, o.name]));

  return rows.map((row) => {
    const body = row.versions[0]?.body ?? "";
    return {
      id: row.id,
      title: row.title,
      visibility: row.visibility,
      tags: row.tags,
      ownerType: row.ownerType as "org" | "department" | "team",
      ownerId: row.ownerId,
      ownerName: nameMap.get(`${row.ownerType}:${row.ownerId}`) ?? "",
      preview: body.slice(0, 120) + (body.length > 120 ? "…" : ""),
    };
  });
}
