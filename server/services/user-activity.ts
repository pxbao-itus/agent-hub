import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import {
  artifactCommentMentions,
  artifactComments,
  artifacts,
  artifactVersions,
  auditEvents,
  departments,
  orgs,
  projects,
  teams,
  workflows,
  workflowEvents,
} from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";
import { artifactAccessCondition, getAccessibleGroups } from "@/server/auth/access";
import type { ProfileViewer } from "@/server/services/user-profile";

export const userActivityFilters = [
  "all",
  "content",
  "collaboration",
  "workflow",
  "organization",
  "administration",
] as const;
export type UserActivityFilter = (typeof userActivityFilters)[number];
type ActivitySource = "version" | "comment" | "mention" | "audit" | "workflow";
type ActivityCategory = Exclude<UserActivityFilter, "all">;

export type UserActivityItem = {
  id: string;
  source: ActivitySource;
  sourceId: string;
  category: ActivityCategory;
  direction: "performed" | "affected";
  createdAt: Date;
  presentation: {
    key: string;
    values: Record<string, string | number | null>;
  };
  target: {
    type: string;
    label: string;
    href: string | null;
  } | null;
};

type ActivityCursor = {
  createdAt: string;
  source: ActivitySource;
  sourceId: string;
};

const SOURCE_RANK: Record<ActivitySource, number> = {
  workflow: 5,
  audit: 4,
  mention: 3,
  comment: 2,
  version: 1,
};

function compareActivity(a: UserActivityItem, b: UserActivityItem) {
  const time = b.createdAt.getTime() - a.createdAt.getTime();
  if (time !== 0) return time;
  const source = SOURCE_RANK[b.source] - SOURCE_RANK[a.source];
  if (source !== 0) return source;
  return b.sourceId.localeCompare(a.sourceId);
}

function encodeCursor(item: UserActivityItem) {
  return Buffer.from(
    JSON.stringify({
      createdAt: item.createdAt.toISOString(),
      source: item.source,
      sourceId: item.sourceId,
    } satisfies ActivityCursor),
  ).toString("base64url");
}

function decodeCursor(value?: string): ActivityCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<ActivityCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      !["version", "comment", "mention", "audit", "workflow"].includes(
        parsed.source ?? "",
      ) ||
      typeof parsed.sourceId !== "string" ||
      Number.isNaN(new Date(parsed.createdAt).getTime())
    ) {
      return null;
    }
    return parsed as ActivityCursor;
  } catch {
    return null;
  }
}

function isAfterCursor(item: UserActivityItem, cursor: ActivityCursor) {
  const cursorItem: UserActivityItem = {
    id: "",
    source: cursor.source,
    sourceId: cursor.sourceId,
    category: "content",
    direction: "performed",
    createdAt: new Date(cursor.createdAt),
    presentation: { key: "", values: {} },
    target: null,
  };
  return compareActivity(item, cursorItem) > 0;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(metadata: Record<string, unknown>, key: string) {
  return typeof metadata[key] === "string" ? metadata[key] as string : null;
}

function affectedByAudit(action: string, metadata: Record<string, unknown>, targetUserId: string) {
  if (action === "user.role") return false;
  const keys = [
    "memberUserId",
    "userId",
    "oldAssignerId",
    "newAssignerId",
    "memberUserId",
  ];
  return keys.some((key) => metadata[key] === targetUserId);
}

function auditCategory(action: string): ActivityCategory {
  if (action.startsWith("assignment.") || action.startsWith("comment.")) return "collaboration";
  if (action.startsWith("membership.") || action.startsWith("project.member.")) return "organization";
  return "administration";
}

function auditKey(action: string) {
  const known = new Set([
    "assignment.assigner.change",
    "assignment.assignee.add",
    "assignment.assignee.remove",
    "assignment.status.change",
    "assignment.priority.change",
    "assignment.due_date.change",
    "membership.add",
    "membership.remove",
    "membership.role",
    "project.member.add",
    "project.member.remove",
    "user.role",
    "artifact.delete",
    "share.grant",
    "share.revoke",
    "token.create",
    "token.revoke",
  ]);
  return known.has(action) ? action : "administration.updated";
}

export async function listUserActivity(
  targetUserId: string,
  viewer: ProfileViewer,
  input: {
    filter?: UserActivityFilter;
    cursor?: string;
    limit?: number;
  },
  db: DbClient,
) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const filter = input.filter ?? "all";
  const cursor = decodeCursor(input.cursor);
  if (input.cursor && !cursor) {
    throw new Error("INVALID_ACTIVITY_CURSOR");
  }
  const before = cursor ? new Date(cursor.createdAt) : undefined;
  const sourceLimit = Math.min(limit * 3 + 1, 151);
  const artifactAccess = await artifactAccessCondition(
    viewer.userId,
    viewer.systemRole,
    db,
  );

  const [
    versionRows,
    commentRows,
    mentionRows,
    auditRows,
    workflowRows,
  ] = await Promise.all([
    db
      .select({
        id: artifactVersions.id,
        createdAt: artifactVersions.createdAt,
        versionNo: artifactVersions.versionNo,
        artifactId: artifacts.id,
        kind: artifacts.kind,
        title: artifacts.title,
      })
      .from(artifactVersions)
      .innerJoin(artifacts, eq(artifacts.id, artifactVersions.artifactId))
      .where(
        and(
          eq(artifactVersions.createdBy, targetUserId),
          before ? lte(artifactVersions.createdAt, before) : undefined,
          artifactAccess,
        ),
      )
      .orderBy(desc(artifactVersions.createdAt), desc(artifactVersions.id))
      .limit(sourceLimit),
    db
      .select({
        id: artifactComments.id,
        createdAt: artifactComments.createdAt,
        deletedAt: artifactComments.deletedAt,
        artifactId: artifacts.id,
        kind: artifacts.kind,
        title: artifacts.title,
      })
      .from(artifactComments)
      .innerJoin(artifacts, eq(artifacts.id, artifactComments.artifactId))
      .where(
        and(
          eq(artifactComments.authorId, targetUserId),
          before ? lte(artifactComments.createdAt, before) : undefined,
          artifactAccess,
        ),
      )
      .orderBy(desc(artifactComments.createdAt), desc(artifactComments.id))
      .limit(sourceLimit),
    db
      .select({
        id: artifactComments.id,
        createdAt: artifactCommentMentions.createdAt,
        artifactId: artifacts.id,
        kind: artifacts.kind,
        title: artifacts.title,
      })
      .from(artifactCommentMentions)
      .innerJoin(artifactComments, eq(artifactComments.id, artifactCommentMentions.commentId))
      .innerJoin(artifacts, eq(artifacts.id, artifactComments.artifactId))
      .where(
        and(
          eq(artifactCommentMentions.userId, targetUserId),
          before ? lte(artifactCommentMentions.createdAt, before) : undefined,
          artifactAccess,
        ),
      )
      .orderBy(desc(artifactCommentMentions.createdAt), desc(artifactComments.id))
      .limit(sourceLimit),
    db
      .select({
        id: auditEvents.id,
        actorId: auditEvents.actorId,
        action: auditEvents.action,
        targetType: auditEvents.targetType,
        targetId: auditEvents.targetId,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .where(
        and(
          or(
            eq(auditEvents.actorId, targetUserId),
            and(eq(auditEvents.targetType, "user"), eq(auditEvents.targetId, targetUserId)),
            sql`${auditEvents.metadata}->>'memberUserId' = ${targetUserId}`,
            sql`${auditEvents.metadata}->>'userId' = ${targetUserId}`,
            sql`${auditEvents.metadata}->>'oldAssignerId' = ${targetUserId}`,
            sql`${auditEvents.metadata}->>'newAssignerId' = ${targetUserId}`,
          ),
          before ? lte(auditEvents.createdAt, before) : undefined,
        ),
      )
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(sourceLimit),
    db
      .select({
        id: workflowEvents.id,
        actorId: workflowEvents.actorId,
        type: workflowEvents.type,
        metadata: workflowEvents.metadata,
        createdAt: workflowEvents.createdAt,
        workflowId: workflows.id,
        workflowName: workflows.name,
        ownerGroupType: workflows.ownerGroupType,
        ownerGroupId: workflows.ownerGroupId,
      })
      .from(workflowEvents)
      .innerJoin(workflows, eq(workflows.id, workflowEvents.workflowId))
      .where(
        and(
          or(
            eq(workflowEvents.actorId, targetUserId),
            sql`${workflowEvents.metadata}->>'fromAssigneeId' = ${targetUserId}`,
            sql`${workflowEvents.metadata}->>'toAssigneeId' = ${targetUserId}`,
          ),
          before ? lte(workflowEvents.createdAt, before) : undefined,
        ),
      )
      .orderBy(desc(workflowEvents.createdAt), desc(workflowEvents.id))
      .limit(sourceLimit),
  ]);

  const accessibleGroups =
    viewer.systemRole === "superadmin"
      ? null
      : new Set(
          (await getAccessibleGroups(viewer.userId, db)).map(
            (group) => `${group.groupType}:${group.groupId}`,
          ),
        );

  const auditArtifactIds = auditRows
    .filter((row) => row.targetType === "artifact" && row.targetId)
    .map((row) => row.targetId!);
  const visibleAuditArtifacts = auditArtifactIds.length
    ? await db
        .select({ id: artifacts.id, kind: artifacts.kind, title: artifacts.title })
        .from(artifacts)
        .where(and(inArray(artifacts.id, auditArtifactIds), artifactAccess))
    : [];
  const auditArtifactById = new Map(visibleAuditArtifacts.map((row) => [row.id, row]));
  const auditProjectIds = auditRows
    .filter((row) => row.targetType === "project" && row.targetId)
    .map((row) => row.targetId!);
  const projectRows = auditProjectIds.length
    ? await db
        .select({
          id: projects.id,
          name: projects.name,
          ownerGroupType: projects.ownerGroupType,
          ownerGroupId: projects.ownerGroupId,
        })
        .from(projects)
        .where(inArray(projects.id, auditProjectIds))
    : [];
  const visibleProjectById = new Map(
    projectRows
      .filter(
        (row) =>
          viewer.systemRole === "superadmin" ||
          accessibleGroups?.has(`${row.ownerGroupType}:${row.ownerGroupId}`),
      )
      .map((row) => [row.id, row]),
  );

  const groupIds = {
    org: auditRows.filter((row) => row.targetType === "org" && row.targetId).map((row) => row.targetId!),
    department: auditRows.filter((row) => row.targetType === "department" && row.targetId).map((row) => row.targetId!),
    team: auditRows.filter((row) => row.targetType === "team" && row.targetId).map((row) => row.targetId!),
  };
  const [auditOrgs, auditDepartments, auditTeams] = await Promise.all([
    groupIds.org.length
      ? db.select({ id: orgs.id, name: orgs.name }).from(orgs).where(inArray(orgs.id, groupIds.org))
      : Promise.resolve([]),
    groupIds.department.length
      ? db.select({ id: departments.id, name: departments.name, orgId: departments.orgId }).from(departments).where(inArray(departments.id, groupIds.department))
      : Promise.resolve([]),
    groupIds.team.length
      ? db.select({ id: teams.id, name: teams.name, departmentId: teams.departmentId }).from(teams).where(inArray(teams.id, groupIds.team))
      : Promise.resolve([]),
  ]);
  const groupTargetByKey = new Map<string, { label: string; href: string | null }>();
  for (const org of auditOrgs) {
    groupTargetByKey.set(`org:${org.id}`, {
      label: org.name,
      href:
        viewer.systemRole === "superadmin" || accessibleGroups?.has(`org:${org.id}`)
          ? `/settings/orgs/${org.id}`
          : null,
    });
  }
  for (const department of auditDepartments) {
    groupTargetByKey.set(`department:${department.id}`, {
      label: department.name,
      href:
        viewer.systemRole === "superadmin" || accessibleGroups?.has(`department:${department.id}`)
          ? `/settings/orgs/${department.orgId}/departments/${department.id}`
          : null,
    });
  }
  const departmentById = new Map(auditDepartments.map((row) => [row.id, row]));
  for (const team of auditTeams) {
    const department = departmentById.get(team.departmentId);
    groupTargetByKey.set(`team:${team.id}`, {
      label: team.name,
      href:
        department && (viewer.systemRole === "superadmin" || accessibleGroups?.has(`team:${team.id}`))
          ? `/settings/orgs/${department.orgId}/departments/${department.id}/teams/${team.id}`
          : null,
    });
  }

  const artifactTarget = (row: { artifactId: string; kind: string; title: string }) => ({
    type: row.kind,
    label: row.title,
    href: `/${row.kind === "doc" ? "docs" : `${row.kind}s`}/${row.artifactId}`,
  });

  const items: UserActivityItem[] = [
    ...versionRows.map((row) => ({
      id: `version:${row.id}`,
      source: "version" as const,
      sourceId: row.id,
      category: "content" as const,
      direction: "performed" as const,
      createdAt: row.createdAt,
      presentation: {
        key: "content.version_created",
        values: { versionNo: row.versionNo },
      },
      target: artifactTarget(row),
    })),
    ...commentRows.map((row) => ({
      id: `comment:${row.id}`,
      source: "comment" as const,
      sourceId: row.id,
      category: "collaboration" as const,
      direction: "performed" as const,
      createdAt: row.createdAt,
      presentation: {
        key: row.deletedAt ? "comment.deleted" : "comment.created",
        values: {},
      },
      target: artifactTarget(row),
    })),
    ...mentionRows.map((row) => ({
      id: `mention:${row.id}`,
      source: "mention" as const,
      sourceId: row.id,
      category: "collaboration" as const,
      direction: "affected" as const,
      createdAt: row.createdAt,
      presentation: { key: "comment.mentioned", values: {} },
      target: artifactTarget(row),
    })),
    ...workflowRows
      .filter(
        (row) =>
          viewer.systemRole === "superadmin" ||
          accessibleGroups?.has(`${row.ownerGroupType}:${row.ownerGroupId}`),
      )
      .map((row) => {
        const metadata = metadataRecord(row.metadata);
        return {
          id: `workflow:${row.id}`,
          source: "workflow" as const,
          sourceId: row.id,
          category: "workflow" as const,
          direction:
            row.actorId === targetUserId ? "performed" as const : "affected" as const,
          createdAt: row.createdAt,
          presentation: {
            key: row.type,
            values: {
              stageName: stringValue(metadata, "stageName"),
              fromStatus: stringValue(metadata, "fromStatus"),
              toStatus: stringValue(metadata, "toStatus"),
            },
          },
          target: {
            type: "workflow",
            label: row.workflowName,
            href: `/workflows/${row.workflowId}`,
          },
        };
      }),
    ...auditRows.flatMap((row): UserActivityItem[] => {
      const metadata = metadataRecord(row.metadata);
      const direction =
        row.actorId === targetUserId && !affectedByAudit(row.action, metadata, targetUserId)
          ? "performed"
          : "affected";
      const category = auditCategory(row.action);
      if (category === "administration" && viewer.systemRole !== "superadmin") return [];

      let target: UserActivityItem["target"] = null;
      if (row.targetType === "artifact" && row.targetId) {
        const artifact = auditArtifactById.get(row.targetId);
        if (!artifact) return [];
        target = artifactTarget({ ...artifact, artifactId: artifact.id });
      } else if (
        row.targetType === "org" ||
        row.targetType === "department" ||
        row.targetType === "team"
      ) {
        const group = row.targetId
          ? groupTargetByKey.get(`${row.targetType}:${row.targetId}`)
          : null;
        target = {
          type: row.targetType,
          label: group?.label ?? stringValue(metadata, "groupName") ?? `${row.targetType} membership`,
          href: group?.href ?? null,
        };
      } else if (row.targetType === "user" && row.targetId === targetUserId) {
        target = { type: "user", label: "User account", href: `/users/${targetUserId}` };
      } else if (row.targetType === "token") {
        target = { type: "token", label: stringValue(metadata, "name") ?? "MCP token", href: null };
      } else if (row.targetType === "project") {
        const project = row.targetId ? visibleProjectById.get(row.targetId) : null;
        if (!project) return [];
        target = { type: "project", label: project.name, href: `/projects/${project.id}` };
      } else if (row.targetId) {
        target = {
          type: row.targetType,
          label: stringValue(metadata, "name") ?? row.targetType,
          href: null,
        };
      }

      return [{
        id: `audit:${row.id}`,
        source: "audit",
        sourceId: row.id,
        category,
        direction,
        createdAt: row.createdAt,
        presentation: {
          key: auditKey(row.action),
          values: {
            role: stringValue(metadata, "role"),
            userName: stringValue(metadata, "userName"),
            oldAssignerName: stringValue(metadata, "oldAssignerName"),
            newAssignerName: stringValue(metadata, "newAssignerName"),
          },
        },
        target,
      }];
    }),
  ].sort(compareActivity);

  const afterCursor = cursor ? items.filter((item) => isAfterCursor(item, cursor)) : items;
  const filtered =
    filter === "all" ? afterCursor : afterCursor.filter((item) => item.category === filter);
  const page = filtered.slice(0, limit);
  const sourceMayHaveMore = [
    versionRows,
    commentRows,
    mentionRows,
    auditRows,
    workflowRows,
  ].some((rows) => rows.length === sourceLimit);

  return {
    items: page,
    nextCursor:
      (filtered.length > limit || sourceMayHaveMore) && page.length
        ? encodeCursor(page[page.length - 1]!)
        : null,
  };
}
