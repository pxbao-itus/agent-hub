import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  artifactAssignments,
  artifactWorkItems,
  artifacts,
  projectArtifacts,
  projects,
  users,
} from "@/server/db/schema";
import type { AssignmentPriority, AssignmentStatus } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";
import { artifactAccessCondition, canMutatePrompt } from "@/server/auth/access";
import { canViewProject } from "@/server/lib/project-access";

export type MyWorkView = "assigned_to_me" | "coordinated_by_me" | "unassigned";
export type MyWorkDue = "overdue" | "today" | "next_7_days" | "no_due_date";
export type MyWorkSort = "due_date" | "priority" | "updated";

export type MyWorkInput = {
  view: MyWorkView;
  kind?: "doc" | "plan";
  status?: AssignmentStatus[];
  priority?: AssignmentPriority[];
  due?: MyWorkDue;
  projectId?: string;
  query?: string;
  sort?: MyWorkSort;
  cursor?: string;
  limit?: number;
};

type Actor = { userId: string; systemRole: "user" | "superadmin" };

function offsetFromCursor(cursor?: string): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function viewCondition(view: MyWorkView, userId: string) {
  const explicitAssignee = sql`exists (
    select 1 from artifact_assignments aa
    where aa.artifact_id = ${artifacts.id}
      and aa.role = 'assignee'
      and aa.user_id = ${userId}
  )`;
  if (view === "assigned_to_me") return explicitAssignee;
  if (view === "unassigned") {
    return sql`not exists (
      select 1 from artifact_assignments aa
      where aa.artifact_id = ${artifacts.id}
        and aa.role = 'assignee'
    )`;
  }
  return sql`coalesce(
    (
      select aa.user_id from artifact_assignments aa
      where aa.artifact_id = ${artifacts.id}
        and aa.role = 'assigner'
      limit 1
    ),
    case when ${artifacts.ownerType} = 'user' then ${artifacts.ownerId} else ${artifacts.createdBy} end
  ) = ${userId}`;
}

function dueCondition(due?: MyWorkDue) {
  if (due === "overdue") {
    return and(
      sql`${artifactWorkItems.dueDate} is not null`,
      sql`${artifactWorkItems.dueDate} < current_date`,
      sql`coalesce(${artifactWorkItems.status}, 'open') <> 'done'`,
    );
  }
  if (due === "today") return sql`${artifactWorkItems.dueDate} = current_date`;
  if (due === "next_7_days") {
    return sql`${artifactWorkItems.dueDate} between current_date and current_date + 7`;
  }
  if (due === "no_due_date") return sql`${artifactWorkItems.dueDate} is null`;
  return undefined;
}

export async function listMyWork(actor: Actor, input: MyWorkInput, db: DbClient) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const offset = offsetFromCursor(input.cursor);
  const access = await artifactAccessCondition(actor.userId, actor.systemRole, db);

  if (input.projectId) {
    const project = await db.query.projects.findFirst({ where: eq(projects.id, input.projectId) });
    if (!project || !(await canViewProject(actor, project, db))) {
      return { items: [], nextCursor: null };
    }
  }

  const where = and(
    inArray(artifacts.kind, input.kind ? [input.kind] : ["doc", "plan"]),
    access,
    viewCondition(input.view, actor.userId),
    input.query
      ? or(
          ilike(artifacts.title, `%${input.query}%`),
          ilike(artifacts.description, `%${input.query}%`),
        )
      : undefined,
    input.status?.length
      ? inArray(sql`coalesce(${artifactWorkItems.status}, 'open')`, input.status)
      : undefined,
    input.priority?.length
      ? inArray(sql`coalesce(${artifactWorkItems.priority}, 'normal')`, input.priority)
      : undefined,
    dueCondition(input.due),
    input.projectId
      ? sql`exists (
          select 1 from project_artifacts pa
          where pa.artifact_id = ${artifacts.id}
            and pa.project_id = ${input.projectId}
        )`
      : undefined,
  );

  const order =
    input.sort === "updated"
      ? [desc(artifacts.updatedAt), asc(artifacts.id)]
      : input.sort === "priority"
        ? [
            sql`case coalesce(${artifactWorkItems.priority}, 'normal')
              when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`,
            sql`${artifactWorkItems.dueDate} asc nulls last`,
            asc(artifacts.id),
          ]
        : [
            sql`${artifactWorkItems.dueDate} asc nulls last`,
            desc(artifacts.updatedAt),
            asc(artifacts.id),
          ];

  // Unassigned requires a per-artifact mutate check. Keep that scan bounded
  // instead of loading the user's whole accessible library.
  const fetchLimit = input.view === "unassigned" ? Math.min(limit * 5 + 1, 501) : limit + 1;
  const rawRows = await db
    .select({
      id: artifacts.id,
      kind: artifacts.kind,
      title: artifacts.title,
      description: artifacts.description,
      ownerType: artifacts.ownerType,
      ownerId: artifacts.ownerId,
      visibility: artifacts.visibility,
      createdBy: artifacts.createdBy,
      updatedAt: artifacts.updatedAt,
      status: artifactWorkItems.status,
      priority: artifactWorkItems.priority,
      dueDate: artifactWorkItems.dueDate,
    })
    .from(artifacts)
    .leftJoin(artifactWorkItems, eq(artifactWorkItems.artifactId, artifacts.id))
    .where(where)
    .orderBy(...order)
    .offset(offset)
    .limit(fetchLimit);

  const permissionRows = await Promise.all(
    rawRows.map(async (row) => ({
      row,
      canManage: await canMutatePrompt(actor, row, db),
    })),
  );
  const eligible = input.view === "unassigned"
    ? permissionRows.filter((entry) => entry.canManage)
    : permissionRows;
  const page = eligible.slice(0, limit);
  const artifactIds = page.map(({ row }) => row.id);

  const assignmentRows = artifactIds.length
    ? await db
        .select({
          artifactId: artifactAssignments.artifactId,
          userId: artifactAssignments.userId,
          role: artifactAssignments.role,
        })
        .from(artifactAssignments)
        .where(inArray(artifactAssignments.artifactId, artifactIds))
    : [];
  const projectRows = artifactIds.length
    ? await db
        .select({
          artifactId: projectArtifacts.artifactId,
          id: projects.id,
          name: projects.name,
          ownerGroupType: projects.ownerGroupType,
          ownerGroupId: projects.ownerGroupId,
        })
        .from(projectArtifacts)
        .innerJoin(projects, eq(projects.id, projectArtifacts.projectId))
        .where(inArray(projectArtifacts.artifactId, artifactIds))
    : [];

  const effectiveAssignerByArtifact = new Map<string, string | null>();
  const assigneeIdsByArtifact = new Map<string, string[]>();
  for (const { row } of page) {
    const explicit = assignmentRows.find((assignment) =>
      assignment.artifactId === row.id && assignment.role === "assigner");
    effectiveAssignerByArtifact.set(
      row.id,
      explicit?.userId ?? (row.ownerType === "user" ? row.ownerId : row.createdBy),
    );
    assigneeIdsByArtifact.set(
      row.id,
      assignmentRows
        .filter((assignment) => assignment.artifactId === row.id && assignment.role === "assignee")
        .map((assignment) => assignment.userId),
    );
  }

  const userIds = [...new Set([
    ...effectiveAssignerByArtifact.values(),
    ...[...assigneeIdsByArtifact.values()].flat(),
  ].filter((id): id is string => Boolean(id)))];
  const userRows = userIds.length
    ? await db.query.users.findMany({
        where: inArray(users.id, userIds),
        columns: { id: true, name: true, email: true, image: true },
      })
    : [];
  const userById = new Map(userRows.map((user) => [user.id, user]));

  const visibleProjects = new Map<string, Array<{ id: string; name: string }>>();
  for (const project of projectRows) {
    if (!(await canViewProject(actor, project, db))) continue;
    const current = visibleProjects.get(project.artifactId) ?? [];
    current.push({ id: project.id, name: project.name });
    visibleProjects.set(project.artifactId, current);
  }

  const items = page.map(({ row, canManage }) => {
    const assignerId = effectiveAssignerByArtifact.get(row.id) ?? null;
    const assigneeIds = assigneeIdsByArtifact.get(row.id) ?? [];
    return {
      artifact: {
        id: row.id,
        kind: row.kind as "doc" | "plan",
        title: row.title,
        description: row.description,
        updatedAt: row.updatedAt,
      },
      assigner: assignerId ? (userById.get(assignerId) ?? null) : null,
      assignees: assigneeIds.flatMap((id) => {
        const user = userById.get(id);
        return user ? [user] : [];
      }),
      status: row.status ?? "open",
      priority: row.priority ?? "normal",
      dueDate: row.dueDate,
      projects: visibleProjects.get(row.id) ?? [],
      canManage,
      canUpdateStatus: canManage || assigneeIds.includes(actor.userId),
    };
  });

  const hasMore = eligible.length > limit || rawRows.length === fetchLimit;
  return {
    items,
    nextCursor: hasMore ? String(offset + rawRows.length) : null,
  };
}

export async function countMyWork(actor: Actor, view: MyWorkView, db: DbClient): Promise<number> {
  const access = await artifactAccessCondition(actor.userId, actor.systemRole, db);

  if (view === "unassigned") {
    const rows = await db
      .select({
        id: artifacts.id,
        ownerType: artifacts.ownerType,
        ownerId: artifacts.ownerId,
        createdBy: artifacts.createdBy,
        visibility: artifacts.visibility,
      })
      .from(artifacts)
      .where(and(
        inArray(artifacts.kind, ["doc", "plan"]),
        access,
        viewCondition(view, actor.userId),
      ));
    const manageable = await Promise.all(rows.map((row) => canMutatePrompt(actor, row, db)));
    return manageable.filter(Boolean).length;
  }

  const [{ value }] = await db
    .select({ value: count() })
    .from(artifacts)
    .where(and(
      inArray(artifacts.kind, ["doc", "plan"]),
      access,
      viewCondition(view, actor.userId),
    ));
  return Number(value);
}
