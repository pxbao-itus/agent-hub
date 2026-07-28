import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DbClient } from "@/server/db/types";
import {
  artifacts,
  projects,
  users,
  workflows,
  workflowEvents,
  workflowStageArtifacts,
  workflowStages,
  type TaskStatus,
  type WorkflowEventSource,
} from "@/server/db/schema";
import { canAccessArtifact } from "@/server/auth/access";
import { canManageWorkflow, canViewWorkflow, type SessionUser } from "@/server/lib/workflow-access";
import { canViewProject } from "@/server/lib/project-access";

type WorkflowRow = typeof workflows.$inferSelect;
type StageRow = typeof workflowStages.$inferSelect;

export type WorkflowActor = SessionUser;
export type WorkflowMutationContext = {
  actor: WorkflowActor;
  source: Exclude<WorkflowEventSource, "system">;
};

type EventMetadata = Record<string, unknown>;

async function findWorkflowOrThrow(id: string, db: DbClient): Promise<WorkflowRow> {
  const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, id) });
  if (!workflow) throw new TRPCError({ code: "NOT_FOUND" });
  return workflow;
}

async function findStageAndWorkflowOrThrow(
  stageId: string,
  db: DbClient,
): Promise<{ stage: StageRow; workflow: WorkflowRow }> {
  const stage = await db.query.workflowStages.findFirst({ where: eq(workflowStages.id, stageId) });
  if (!stage) throw new TRPCError({ code: "NOT_FOUND" });
  const workflow = await findWorkflowOrThrow(stage.workflowId, db);
  return { stage, workflow };
}

async function requireManager(context: WorkflowMutationContext, workflow: WorkflowRow, db: DbClient) {
  const allowed = await canManageWorkflow(
    context.actor,
    workflow.ownerGroupType,
    workflow.ownerGroupId,
    db,
  );
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });
}

async function requireViewableProject(
  projectId: string,
  actor: WorkflowActor,
  db: DbClient,
) {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project || !(await canViewProject(actor, project, db))) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
  return project;
}

async function appendEvent(
  tx: Parameters<Parameters<DbClient["transaction"]>[0]>[0],
  input: {
    workflowId: string;
    stageId?: string | null;
    context: WorkflowMutationContext;
    type: string;
    metadata?: EventMetadata;
  },
) {
  await tx.insert(workflowEvents).values({
    workflowId: input.workflowId,
    stageId: input.stageId ?? null,
    actorId: input.context.actor.userId,
    source: input.context.source,
    type: input.type,
    metadata: input.metadata,
  });
}

async function touchWorkflow(
  tx: Parameters<Parameters<DbClient["transaction"]>[0]>[0],
  workflowId: string,
  now: Date,
) {
  await tx.update(workflows).set({ updatedAt: now }).where(eq(workflows.id, workflowId));
}

export async function canUpdateWorkflowStageStatus(
  actor: WorkflowActor,
  stage: Pick<StageRow, "assigneeId">,
  workflow: Pick<WorkflowRow, "ownerGroupType" | "ownerGroupId">,
  db: DbClient,
) {
  if (stage.assigneeId === actor.userId) {
    return canViewWorkflow(actor, workflow, db);
  }
  return canManageWorkflow(actor, workflow.ownerGroupType, workflow.ownerGroupId, db);
}

export async function createWorkflow(
  input: {
    ownerGroupType: WorkflowRow["ownerGroupType"];
    ownerGroupId: string;
    projectId?: string;
    name: string;
    description?: string;
    stages: string[];
  },
  context: WorkflowMutationContext,
  db: DbClient,
) {
  const allowed = await canManageWorkflow(
    context.actor,
    input.ownerGroupType,
    input.ownerGroupId,
    db,
  );
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

  const project = input.projectId
    ? await requireViewableProject(input.projectId, context.actor, db)
    : null;

  return db.transaction(async (tx) => {
    const [workflow] = await tx
      .insert(workflows)
      .values({
        ownerGroupType: input.ownerGroupType,
        ownerGroupId: input.ownerGroupId,
        projectId: project?.id ?? null,
        name: input.name,
        description: input.description,
        createdBy: context.actor.userId,
      })
      .returning();

    if (input.stages.length > 0) {
      await tx.insert(workflowStages).values(
        input.stages.map((name, position) => ({
          workflowId: workflow.id,
          name,
          position,
        })),
      );
    }

    await appendEvent(tx, {
      workflowId: workflow.id,
      context,
      type: "workflow.created",
      metadata: {
        name: workflow.name,
        stageCount: input.stages.length,
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
      },
    });
    return workflow;
  });
}

export async function updateWorkflow(
  input: {
    id: string;
    name?: string;
    description?: string | null;
    projectId?: string | null;
  },
  context: WorkflowMutationContext,
  db: DbClient,
) {
  const workflow = await findWorkflowOrThrow(input.id, db);
  await requireManager(context, workflow, db);

  const nextProject =
    input.projectId === undefined || input.projectId === null
      ? null
      : await requireViewableProject(input.projectId, context.actor, db);
  const previousProject =
    workflow.projectId && workflow.projectId !== nextProject?.id
      ? await db.query.projects.findFirst({
          where: eq(projects.id, workflow.projectId),
          columns: { id: true, name: true },
        })
      : null;

  const updates: Partial<Pick<WorkflowRow, "name" | "description" | "projectId" | "updatedAt">> = {};
  const changedFields: string[] = [];
  if (input.name !== undefined && input.name !== workflow.name) {
    updates.name = input.name;
    changedFields.push("name");
  }
  if (input.description !== undefined && input.description !== workflow.description) {
    updates.description = input.description;
    changedFields.push("description");
  }
  if (input.projectId !== undefined && input.projectId !== workflow.projectId) {
    updates.projectId = input.projectId;
    changedFields.push("project");
  }
  if (changedFields.length === 0) return workflow;

  const now = new Date();
  updates.updatedAt = now;
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(workflows)
      .set(updates)
      .where(eq(workflows.id, workflow.id))
      .returning();
    await appendEvent(tx, {
      workflowId: workflow.id,
      context,
      type: "workflow.updated",
      metadata: {
        changedFields,
        fromProjectId: changedFields.includes("project") ? workflow.projectId : undefined,
        fromProjectName: changedFields.includes("project") ? (previousProject?.name ?? null) : undefined,
        toProjectId: changedFields.includes("project") ? (nextProject?.id ?? null) : undefined,
        toProjectName: changedFields.includes("project") ? (nextProject?.name ?? null) : undefined,
      },
    });
    return updated;
  });
}

export async function addWorkflowStage(
  input: { workflowId: string; name: string },
  context: WorkflowMutationContext,
  db: DbClient,
) {
  const workflow = await findWorkflowOrThrow(input.workflowId, db);
  await requireManager(context, workflow, db);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${workflows} where id = ${workflow.id} for update`);
    const [{ maxPos }] = await tx
      .select({ maxPos: sql<number>`coalesce(max(${workflowStages.position}), -1)::int` })
      .from(workflowStages)
      .where(eq(workflowStages.workflowId, workflow.id));
    const now = new Date();
    const [stage] = await tx
      .insert(workflowStages)
      .values({ workflowId: workflow.id, name: input.name, position: maxPos + 1 })
      .returning();
    await touchWorkflow(tx, workflow.id, now);
    await appendEvent(tx, {
      workflowId: workflow.id,
      stageId: stage.id,
      context,
      type: "stage.added",
      metadata: { stageName: stage.name, position: stage.position },
    });
    return stage;
  });
}

export async function updateWorkflowStageDetails(
  input: {
    stageId: string;
    name?: string;
    description?: string | null;
    acceptanceCriteria?: string | null;
    assigneeId?: string | null;
    dueDate?: string | null;
  },
  context: WorkflowMutationContext,
  db: DbClient,
) {
  const { stage, workflow } = await findStageAndWorkflowOrThrow(input.stageId, db);
  await requireManager(context, workflow, db);

  let nextAssignee: Pick<typeof users.$inferSelect, "id" | "name" | "username"> | null | undefined;
  if (input.assigneeId !== undefined) {
    if (input.assigneeId === null) {
      nextAssignee = null;
    } else {
      const target = await db.query.users.findFirst({
        where: eq(users.id, input.assigneeId),
        columns: { id: true, name: true, username: true, systemRole: true },
      });
      if (!target || !(await canViewWorkflow(
        { userId: target.id, systemRole: target.systemRole },
        workflow,
        db,
      ))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "User cannot access this workflow" });
      }
      nextAssignee = target;
    }
  }

  const previousAssignee = stage.assigneeId
    ? await db.query.users.findFirst({
        where: eq(users.id, stage.assigneeId),
        columns: { id: true, name: true, username: true },
      })
    : null;

  const updates: Partial<
    Pick<
      StageRow,
      "name" | "description" | "acceptanceCriteria" | "assigneeId" | "dueDate" | "updatedAt"
    >
  > = {};
  const changedFields: string[] = [];
  const compare = <K extends "name" | "description" | "acceptanceCriteria" | "assigneeId" | "dueDate">(
    key: K,
    value: StageRow[K] | undefined,
  ) => {
    if (value !== undefined && value !== stage[key]) {
      updates[key] = value as never;
      changedFields.push(key);
    }
  };
  compare("name", input.name);
  compare("description", input.description);
  compare("acceptanceCriteria", input.acceptanceCriteria);
  compare("assigneeId", input.assigneeId);
  compare("dueDate", input.dueDate);
  if (changedFields.length === 0) return stage;

  const now = new Date();
  updates.updatedAt = now;
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(workflowStages)
      .set(updates)
      .where(eq(workflowStages.id, stage.id))
      .returning();
    await touchWorkflow(tx, workflow.id, now);
    await appendEvent(tx, {
      workflowId: workflow.id,
      stageId: stage.id,
      context,
      type: "stage.details.changed",
      metadata: {
        stageName: updates.name ?? stage.name,
        changedFields,
        fromAssigneeId: changedFields.includes("assigneeId") ? (previousAssignee?.id ?? null) : undefined,
        fromAssigneeUsername: changedFields.includes("assigneeId")
          ? (previousAssignee?.username ?? null)
          : undefined,
        toAssigneeId: changedFields.includes("assigneeId") ? (nextAssignee?.id ?? null) : undefined,
        toAssigneeUsername: changedFields.includes("assigneeId")
          ? (nextAssignee?.username ?? null)
          : undefined,
        fromDueDate: changedFields.includes("dueDate") ? stage.dueDate : undefined,
        toDueDate: changedFields.includes("dueDate") ? (input.dueDate ?? null) : undefined,
      },
    });
    return updated;
  });
}

export async function removeWorkflowStage(
  stageId: string,
  context: WorkflowMutationContext,
  db: DbClient,
) {
  const { stage, workflow } = await findStageAndWorkflowOrThrow(stageId, db);
  await requireManager(context, workflow, db);

  const [{ attachmentCount }] = await db
    .select({ attachmentCount: sql<number>`count(*)::int` })
    .from(workflowStageArtifacts)
    .where(eq(workflowStageArtifacts.stageId, stage.id));

  await db.transaction(async (tx) => {
    const now = new Date();
    await appendEvent(tx, {
      workflowId: workflow.id,
      stageId: stage.id,
      context,
      type: "stage.removed",
      metadata: { stageName: stage.name, attachmentCount },
    });
    await tx.delete(workflowStages).where(eq(workflowStages.id, stage.id));
    await touchWorkflow(tx, workflow.id, now);
  });
}

export async function reorderWorkflowStages(
  input: { workflowId: string; stageIds: string[] },
  context: WorkflowMutationContext,
  db: DbClient,
) {
  const workflow = await findWorkflowOrThrow(input.workflowId, db);
  await requireManager(context, workflow, db);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${workflows} where id = ${workflow.id} for update`);
    const existing = await tx.query.workflowStages.findMany({
      where: eq(workflowStages.workflowId, workflow.id),
      columns: { id: true, position: true },
      orderBy: asc(workflowStages.position),
    });
    const existingIds = new Set(existing.map((row) => row.id));
    const sameSet =
      input.stageIds.length === existingIds.size &&
      input.stageIds.every((id) => existingIds.has(id));
    if (!sameSet) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "stageIds must exactly match the workflow's current stages",
      });
    }
    if (existing.every((row, index) => row.id === input.stageIds[index])) {
      return { ok: true, changed: false };
    }

    const now = new Date();
    for (const [position, id] of input.stageIds.entries()) {
      await tx
        .update(workflowStages)
        .set({ position, updatedAt: now })
        .where(and(eq(workflowStages.id, id), eq(workflowStages.workflowId, workflow.id)));
    }
    await touchWorkflow(tx, workflow.id, now);
    await appendEvent(tx, {
      workflowId: workflow.id,
      context,
      type: "stage.reordered",
      metadata: {
        fromStageIds: existing.map((row) => row.id),
        toStageIds: input.stageIds,
      },
    });
    return { ok: true, changed: true };
  });
}

export async function setWorkflowStageStatus(
  input: { stageId: string; status: TaskStatus },
  context: WorkflowMutationContext,
  db: DbClient,
) {
  const { stage, workflow } = await findStageAndWorkflowOrThrow(input.stageId, db);
  if (!(await canUpdateWorkflowStageStatus(context.actor, stage, workflow, db))) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  if (stage.status === input.status) return stage;

  return db.transaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(workflowStages)
      .set({ status: input.status, updatedAt: now })
      .where(eq(workflowStages.id, stage.id))
      .returning();
    await touchWorkflow(tx, workflow.id, now);
    await appendEvent(tx, {
      workflowId: workflow.id,
      stageId: stage.id,
      context,
      type: "stage.status.changed",
      metadata: { stageName: stage.name, from: stage.status, to: input.status },
    });
    return updated;
  });
}

export async function attachArtifactToWorkflowStage(
  input: { stageId: string; artifactId: string },
  context: WorkflowMutationContext,
  db: DbClient,
) {
  const { stage, workflow } = await findStageAndWorkflowOrThrow(input.stageId, db);
  await requireManager(context, workflow, db);
  const artifact = await db.query.artifacts.findFirst({ where: eq(artifacts.id, input.artifactId) });
  if (!artifact) throw new TRPCError({ code: "NOT_FOUND" });
  if (!(await canAccessArtifact(context.actor, artifact, db))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot access this artifact" });
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${workflowStages} where id = ${stage.id} for update`);
    const [{ maxPos }] = await tx
      .select({ maxPos: sql<number>`coalesce(max(${workflowStageArtifacts.position}), -1)::int` })
      .from(workflowStageArtifacts)
      .where(eq(workflowStageArtifacts.stageId, stage.id));
    const [row] = await tx
      .insert(workflowStageArtifacts)
      .values({ stageId: stage.id, artifactId: artifact.id, position: maxPos + 1 })
      .onConflictDoNothing()
      .returning();
    if (!row) return null;

    const now = new Date();
    await touchWorkflow(tx, workflow.id, now);
    await appendEvent(tx, {
      workflowId: workflow.id,
      stageId: stage.id,
      context,
      type: "artifact.attached",
      metadata: {
        stageName: stage.name,
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        artifactTitle: artifact.title,
      },
    });
    return row;
  });
}

export async function detachArtifactFromWorkflowStage(
  input: { stageId: string; artifactId: string },
  context: WorkflowMutationContext,
  db: DbClient,
) {
  const { stage, workflow } = await findStageAndWorkflowOrThrow(input.stageId, db);
  await requireManager(context, workflow, db);
  const artifact = await db.query.artifacts.findFirst({
    where: eq(artifacts.id, input.artifactId),
    columns: { id: true, kind: true, title: true },
  });

  return db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(workflowStageArtifacts)
      .where(
        and(
          eq(workflowStageArtifacts.stageId, stage.id),
          eq(workflowStageArtifacts.artifactId, input.artifactId),
        ),
      )
      .returning();
    if (!removed) return false;

    const now = new Date();
    await touchWorkflow(tx, workflow.id, now);
    await appendEvent(tx, {
      workflowId: workflow.id,
      stageId: stage.id,
      context,
      type: "artifact.detached",
      metadata: {
        stageName: stage.name,
        artifactId: input.artifactId,
        artifactKind: artifact?.kind ?? null,
        artifactTitle: artifact?.title ?? null,
      },
    });
    return true;
  });
}

export async function deleteWorkflow(
  id: string,
  context: WorkflowMutationContext,
  db: DbClient,
) {
  const workflow = await findWorkflowOrThrow(id, db);
  await requireManager(context, workflow, db);
  await db.delete(workflows).where(eq(workflows.id, workflow.id));
  return workflow;
}

export async function listWorkflowActivity(
  workflowId: string,
  actor: WorkflowActor,
  input: { cursor?: { createdAt: Date; id: string }; limit: number },
  db: DbClient,
) {
  const workflow = await findWorkflowOrThrow(workflowId, db);
  if (!(await canViewWorkflow(actor, workflow, db))) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }

  const cursorWhere = input.cursor
    ? sql`(${workflowEvents.createdAt}, ${workflowEvents.id}) < (${input.cursor.createdAt}, ${input.cursor.id})`
    : undefined;
  const rows = await db.query.workflowEvents.findMany({
    where: cursorWhere
      ? and(eq(workflowEvents.workflowId, workflow.id), cursorWhere)
      : eq(workflowEvents.workflowId, workflow.id),
    with: {
      actor: {
        columns: { id: true, name: true, username: true, image: true },
      },
    },
    orderBy: [sql`${workflowEvents.createdAt} desc`, sql`${workflowEvents.id} desc`],
    limit: input.limit + 1,
  });

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      hasMore && last
        ? { createdAt: last.createdAt.toISOString(), id: last.id }
        : null,
  };
}

export async function listAssignedWorkflowStages(
  actor: WorkflowActor,
  input: {
    status?: TaskStatus[];
    due?: "overdue" | "today" | "next_7_days" | "no_due_date";
    projectId?: string;
    query?: string;
    limit: number;
    cursor?: string;
  },
  db: DbClient,
) {
  const conditions = [eq(workflowStages.assigneeId, actor.userId)];
  if (input.status?.length) conditions.push(inArray(workflowStages.status, input.status));
  if (input.projectId) conditions.push(eq(workflows.projectId, input.projectId));
  if (input.query) {
    conditions.push(
      sql`(${workflowStages.name} ilike ${`%${input.query}%`} or ${workflows.name} ilike ${`%${input.query}%`})`,
    );
  }
  if (input.cursor) conditions.push(sql`${workflowStages.id} > ${input.cursor}`);

  const today = new Date().toISOString().slice(0, 10);
  if (input.due === "overdue") {
    conditions.push(sql`${workflowStages.dueDate} < ${today} and ${workflowStages.status} <> 'done'`);
  } else if (input.due === "today") {
    conditions.push(eq(workflowStages.dueDate, today));
  } else if (input.due === "next_7_days") {
    conditions.push(
      sql`${workflowStages.dueDate} between ${today}::date and (${today}::date + interval '7 days')`,
    );
  } else if (input.due === "no_due_date") {
    conditions.push(sql`${workflowStages.dueDate} is null`);
  }

  const rows = await db
    .select({ stage: workflowStages, workflow: workflows })
    .from(workflowStages)
    .innerJoin(workflows, eq(workflowStages.workflowId, workflows.id))
    .where(and(...conditions))
    .orderBy(asc(workflowStages.id))
    .limit(input.limit * 3 + 1);

  const visible: typeof rows = [];
  for (const row of rows) {
    if (visible.length > input.limit) break;
    if (await canViewWorkflow(actor, row.workflow, db)) visible.push(row);
  }
  const hasMore = visible.length > input.limit;
  const items = hasMore ? visible.slice(0, input.limit) : visible;
  return {
    items,
    nextCursor: hasMore ? (items.at(-1)?.stage.id ?? null) : null,
  };
}
