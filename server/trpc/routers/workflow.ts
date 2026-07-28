import { z } from "zod";
import { eq, or, and, asc, desc, ilike } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { workflows, workflowStages, workflowStageArtifacts, artifacts, projects, users } from "@/server/db/schema";
import { getAccessibleGroups, canAccessArtifact } from "@/server/auth/access";
import {
  canViewWorkflow,
  canManageWorkflow,
  attachWorkflowManageFlags,
  attachWorkflowProgress,
} from "@/server/lib/workflow-access";
import { recordAudit } from "@/server/services/audit";
import type { DbClient } from "@/server/db/types";
import { canViewProject } from "@/server/lib/project-access";
import {
  addWorkflowStage,
  attachArtifactToWorkflowStage,
  canUpdateWorkflowStageStatus,
  createWorkflow,
  deleteWorkflow,
  detachArtifactFromWorkflowStage,
  listAssignedWorkflowStages,
  listWorkflowActivity,
  removeWorkflowStage,
  reorderWorkflowStages,
  setWorkflowStageStatus,
  updateWorkflow,
  updateWorkflowStageDetails,
} from "@/server/services/workflow";

const groupTypeSchema = z.enum(["org", "department", "team"]);
const stageStatusSchema = z.enum(["todo", "doing", "done"]);

async function findWorkflowOrThrow(id: string, db: DbClient) {
  const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, id) });
  if (!workflow) throw new TRPCError({ code: "NOT_FOUND" });
  return workflow;
}

const actor = (session: { userId: string; systemRole: "user" | "superadmin" }) => ({
  userId: session.userId,
  systemRole: session.systemRole,
});

const uiContext = (session: { userId: string; systemRole: "user" | "superadmin" }) => ({
  actor: actor(session),
  source: "ui" as const,
});

export const workflowRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        ownerGroupType: groupTypeSchema,
        ownerGroupId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
        name: z.string().min(1).max(200),
        description: z.string().max(500).optional(),
        // Initial stage names in order — the "prefill from an SDLC template"
        // UX (plan §8.1) is purely a client-side default; the server just
        // takes whatever list it's given.
        stages: z.array(z.string().min(1).max(100)).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return createWorkflow(input, uiContext(ctx.session), ctx.db);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(500).nullable().optional(),
        projectId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return updateWorkflow(input, uiContext(ctx.session), ctx.db);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const workflow = await deleteWorkflow(input.id, uiContext(ctx.session), ctx.db);

      await recordAudit(
        { actorId: ctx.session.userId, action: "workflow.delete", targetType: "workflow", targetId: input.id, metadata: { name: workflow.name } },
        ctx.db,
      );
    }),

  /** Every workflow the caller can see (cone over the owning group), newest first. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const { userId, systemRole } = ctx.session;

    let where;
    if (systemRole !== "superadmin") {
      const groups = await getAccessibleGroups(userId, ctx.db);
      if (!groups.length) return [];
      where = or(
        ...groups.map((g) => and(eq(workflows.ownerGroupType, g.groupType), eq(workflows.ownerGroupId, g.groupId))),
      );
    }

    const rows = await ctx.db.query.workflows.findMany({ where, orderBy: desc(workflows.updatedAt) });
    if (!rows.length) return [];

    const withProgress = await attachWorkflowProgress(rows, ctx.db);
    return attachWorkflowManageFlags(withProgress, { userId, systemRole }, ctx.db);
  }),

  /** Workflows linked to a given project, filtered to what the caller can see. */
  listForProject: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.projectId),
      });
      if (!project || !(await canViewProject({ userId, systemRole }, project, ctx.db))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const rows = await ctx.db.query.workflows.findMany({
        where: eq(workflows.projectId, input.projectId),
        orderBy: desc(workflows.updatedAt),
      });
      if (!rows.length) return [];

      const viewable = [];
      for (const w of rows) {
        const ok = await canViewWorkflow({ userId, systemRole }, w, ctx.db);
        if (ok) viewable.push(w);
      }
      if (!viewable.length) return [];

      const withProgress = await attachWorkflowProgress(viewable, ctx.db);
      return attachWorkflowManageFlags(withProgress, { userId, systemRole }, ctx.db);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const workflow = await findWorkflowOrThrow(input.id, ctx.db);

      const viewable = await canViewWorkflow({ userId, systemRole }, workflow, ctx.db);
      if (!viewable) throw new TRPCError({ code: "FORBIDDEN" });

      const [canManage, stageRows, stageArtifactRows, project] = await Promise.all([
        canManageWorkflow({ userId, systemRole }, workflow.ownerGroupType, workflow.ownerGroupId, ctx.db),
        ctx.db.query.workflowStages.findMany({
          where: eq(workflowStages.workflowId, workflow.id),
          with: {
            assignee: {
              columns: { id: true, name: true, username: true, image: true },
            },
          },
          orderBy: asc(workflowStages.position),
        }),
        ctx.db
          .select({ stageId: workflowStageArtifacts.stageId, artifact: artifacts })
          .from(workflowStageArtifacts)
          .innerJoin(workflowStages, eq(workflowStageArtifacts.stageId, workflowStages.id))
          .innerJoin(artifacts, eq(workflowStageArtifacts.artifactId, artifacts.id))
          .where(eq(workflowStages.workflowId, workflow.id))
          .orderBy(asc(workflowStageArtifacts.position)),
        workflow.projectId
          ? ctx.db.query.projects.findFirst({ where: eq(projects.id, workflow.projectId) })
          : Promise.resolve(null),
      ]);

      // Group attachments by stage, filtered to what the viewer can actually
      // read — a workflow is organizational, it never grants artifact access.
      const byStage = new Map<string, (typeof stageArtifactRows)[number]["artifact"][]>();
      for (const row of stageArtifactRows) {
        const ok = await canAccessArtifact({ userId, systemRole }, row.artifact, ctx.db);
        if (!ok) continue;
        if (!byStage.has(row.stageId)) byStage.set(row.stageId, []);
        byStage.get(row.stageId)!.push(row.artifact);
      }

      const stages = await Promise.all(
        stageRows.map(async (stage) => ({
          ...stage,
          artifacts: byStage.get(stage.id) ?? [],
          canUpdateStatus: await canUpdateWorkflowStageStatus(
            { userId, systemRole },
            stage,
            workflow,
            ctx.db,
          ),
        })),
      );

      const linkedProject =
        project && (await canViewProject({ userId, systemRole }, project, ctx.db))
          ? { id: project.id, name: project.name }
          : null;

      return { ...workflow, project: linkedProject, canManage, stages };
    }),

  addStage: protectedProcedure
    .input(z.object({ workflowId: z.string().uuid(), name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      return addWorkflowStage(input, uiContext(ctx.session), ctx.db);
    }),

  updateStage: protectedProcedure
    .input(z.object({ stageId: z.string().uuid(), name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      return updateWorkflowStageDetails(input, uiContext(ctx.session), ctx.db);
    }),

  updateStageDetails: protectedProcedure
    .input(
      z.object({
        stageId: z.string().uuid(),
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(10_000).nullable().optional(),
        acceptanceCriteria: z.string().max(10_000).nullable().optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        dueDate: z.string().date().nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      updateWorkflowStageDetails(input, uiContext(ctx.session), ctx.db),
    ),

  removeStage: protectedProcedure
    .input(z.object({ stageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await removeWorkflowStage(input.stageId, uiContext(ctx.session), ctx.db);
    }),

  reorderStages: protectedProcedure
    .input(z.object({ workflowId: z.string().uuid(), stageIds: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      return reorderWorkflowStages(input, uiContext(ctx.session), ctx.db);
    }),

  setStageStatus: protectedProcedure
    .input(z.object({ stageId: z.string().uuid(), status: stageStatusSchema }))
    .mutation(async ({ ctx, input }) => {
      return setWorkflowStageStatus(input, uiContext(ctx.session), ctx.db);
    }),

  attachArtifact: protectedProcedure
    .input(z.object({ stageId: z.string().uuid(), artifactId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return attachArtifactToWorkflowStage(input, uiContext(ctx.session), ctx.db);
    }),

  detachArtifact: protectedProcedure
    .input(z.object({ stageId: z.string().uuid(), artifactId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return detachArtifactFromWorkflowStage(input, uiContext(ctx.session), ctx.db);
    }),

  searchStageAssigneeCandidates: protectedProcedure
    .input(
      z.object({
        workflowId: z.string().uuid(),
        query: z.string().trim().max(100).default(""),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const workflow = await findWorkflowOrThrow(input.workflowId, ctx.db);
      const identity = actor(ctx.session);
      if (!(await canManageWorkflow(identity, workflow.ownerGroupType, workflow.ownerGroupId, ctx.db))) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const where = input.query
        ? or(
            ilike(users.name, `%${input.query}%`),
            ilike(users.username, `%${input.query}%`),
            ilike(users.email, `%${input.query}%`),
          )
        : undefined;
      const candidates = await ctx.db.query.users.findMany({
        where,
        columns: {
          id: true,
          name: true,
          username: true,
          email: true,
          image: true,
          systemRole: true,
        },
        orderBy: asc(users.name),
        limit: 200,
      });
      const result = [];
      for (const candidate of candidates) {
        if (result.length >= input.limit) break;
        if (
          await canViewWorkflow(
            { userId: candidate.id, systemRole: candidate.systemRole },
            workflow,
            ctx.db,
          )
        ) {
          result.push(candidate);
        }
      }
      return result;
    }),

  activity: protectedProcedure
    .input(
      z.object({
        workflowId: z.string().uuid(),
        cursor: z
          .object({ createdAt: z.string().datetime(), id: z.string().uuid() })
          .optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(({ ctx, input }) =>
      listWorkflowActivity(
        input.workflowId,
        actor(ctx.session),
        {
          cursor: input.cursor
            ? { createdAt: new Date(input.cursor.createdAt), id: input.cursor.id }
            : undefined,
          limit: input.limit,
        },
        ctx.db,
      ),
    ),

  listMyStages: protectedProcedure
    .input(
      z.object({
        status: z.array(stageStatusSchema).optional(),
        due: z.enum(["overdue", "today", "next_7_days", "no_due_date"]).optional(),
        projectId: z.string().uuid().optional(),
        query: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(50).default(25),
        cursor: z.string().uuid().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      listAssignedWorkflowStages(actor(ctx.session), input, ctx.db),
    ),
});
