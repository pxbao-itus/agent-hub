import { z } from "zod";
import { eq, and, or, asc, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { workflows, workflowStages, workflowStageArtifacts, artifacts, projects } from "@/server/db/schema";
import { getAccessibleGroups, canAccessArtifact } from "@/server/auth/access";
import {
  canViewWorkflow,
  canManageWorkflow,
  attachWorkflowManageFlags,
  attachWorkflowProgress,
  type GroupType,
  type SessionUser,
} from "@/server/lib/workflow-access";
import { recordAudit } from "@/server/services/audit";
import type { DbClient } from "@/server/db/types";

const groupTypeSchema = z.enum(["org", "department", "team"]);
const stageStatusSchema = z.enum(["todo", "doing", "done"]);

async function requireManage(
  user: SessionUser,
  ownerGroupType: GroupType,
  ownerGroupId: string,
  db: DbClient,
) {
  const allowed = await canManageWorkflow(user, ownerGroupType, ownerGroupId, db);
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });
}

async function findWorkflowOrThrow(id: string, db: DbClient) {
  const workflow = await db.query.workflows.findFirst({ where: eq(workflows.id, id) });
  if (!workflow) throw new TRPCError({ code: "NOT_FOUND" });
  return workflow;
}

/** Resolves a stage to its parent workflow (for permission checks) or throws. */
async function findStageAndWorkflowOrThrow(stageId: string, db: DbClient) {
  const stage = await db.query.workflowStages.findFirst({ where: eq(workflowStages.id, stageId) });
  if (!stage) throw new TRPCError({ code: "NOT_FOUND" });
  const workflow = await findWorkflowOrThrow(stage.workflowId, db);
  return { stage, workflow };
}

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
      const { userId, systemRole } = ctx.session;
      await requireManage({ userId, systemRole }, input.ownerGroupType, input.ownerGroupId, ctx.db);

      if (input.projectId) {
        const project = await ctx.db.query.projects.findFirst({ where: eq(projects.id, input.projectId) });
        if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const [workflow] = await ctx.db
        .insert(workflows)
        .values({
          ownerGroupType: input.ownerGroupType,
          ownerGroupId: input.ownerGroupId,
          projectId: input.projectId ?? null,
          name: input.name,
          description: input.description,
          createdBy: userId,
        })
        .returning();

      if (input.stages.length > 0) {
        await ctx.db.insert(workflowStages).values(
          input.stages.map((name, i) => ({ workflowId: workflow.id, name, position: i })),
        );
      }

      return workflow;
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
      const { userId, systemRole } = ctx.session;
      const { id, ...meta } = input;

      const workflow = await findWorkflowOrThrow(id, ctx.db);
      await requireManage({ userId, systemRole }, workflow.ownerGroupType, workflow.ownerGroupId, ctx.db);

      if (meta.projectId) {
        const project = await ctx.db.query.projects.findFirst({ where: eq(projects.id, meta.projectId) });
        if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const metaUpdates = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));

      const [updated] = await ctx.db
        .update(workflows)
        .set({ ...metaUpdates, updatedAt: new Date() })
        .where(eq(workflows.id, id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const workflow = await findWorkflowOrThrow(input.id, ctx.db);
      await requireManage({ userId, systemRole }, workflow.ownerGroupType, workflow.ownerGroupId, ctx.db);

      // Cascades to workflow_stages/workflow_stage_artifacts only — the
      // underlying artifacts and the optionally-linked project are untouched.
      await ctx.db.delete(workflows).where(eq(workflows.id, input.id));

      await recordAudit(
        { actorId: userId, action: "workflow.delete", targetType: "workflow", targetId: input.id, metadata: { name: workflow.name } },
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

      const [canManage, stageRows, stageArtifactRows] = await Promise.all([
        canManageWorkflow({ userId, systemRole }, workflow.ownerGroupType, workflow.ownerGroupId, ctx.db),
        ctx.db.query.workflowStages.findMany({
          where: eq(workflowStages.workflowId, workflow.id),
          orderBy: asc(workflowStages.position),
        }),
        ctx.db
          .select({ stageId: workflowStageArtifacts.stageId, artifact: artifacts })
          .from(workflowStageArtifacts)
          .innerJoin(workflowStages, eq(workflowStageArtifacts.stageId, workflowStages.id))
          .innerJoin(artifacts, eq(workflowStageArtifacts.artifactId, artifacts.id))
          .where(eq(workflowStages.workflowId, workflow.id))
          .orderBy(asc(workflowStageArtifacts.position)),
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

      const stages = stageRows.map((stage) => ({ ...stage, artifacts: byStage.get(stage.id) ?? [] }));

      return { ...workflow, canManage, stages };
    }),

  addStage: protectedProcedure
    .input(z.object({ workflowId: z.string().uuid(), name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const workflow = await findWorkflowOrThrow(input.workflowId, ctx.db);
      await requireManage({ userId, systemRole }, workflow.ownerGroupType, workflow.ownerGroupId, ctx.db);

      const [{ maxPos }] = await ctx.db
        .select({ maxPos: sql<number>`coalesce(max(position), -1)` })
        .from(workflowStages)
        .where(eq(workflowStages.workflowId, input.workflowId));

      const [stage] = await ctx.db
        .insert(workflowStages)
        .values({ workflowId: input.workflowId, name: input.name, position: maxPos + 1 })
        .returning();

      return stage;
    }),

  updateStage: protectedProcedure
    .input(z.object({ stageId: z.string().uuid(), name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const { workflow } = await findStageAndWorkflowOrThrow(input.stageId, ctx.db);
      await requireManage({ userId, systemRole }, workflow.ownerGroupType, workflow.ownerGroupId, ctx.db);

      const [updated] = await ctx.db
        .update(workflowStages)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(workflowStages.id, input.stageId))
        .returning();

      return updated;
    }),

  removeStage: protectedProcedure
    .input(z.object({ stageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const { workflow } = await findStageAndWorkflowOrThrow(input.stageId, ctx.db);
      await requireManage({ userId, systemRole }, workflow.ownerGroupType, workflow.ownerGroupId, ctx.db);

      await ctx.db.delete(workflowStages).where(eq(workflowStages.id, input.stageId));
    }),

  reorderStages: protectedProcedure
    .input(z.object({ workflowId: z.string().uuid(), stageIds: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const workflow = await findWorkflowOrThrow(input.workflowId, ctx.db);
      await requireManage({ userId, systemRole }, workflow.ownerGroupType, workflow.ownerGroupId, ctx.db);

      const existing = await ctx.db.query.workflowStages.findMany({
        where: eq(workflowStages.workflowId, input.workflowId),
        columns: { id: true },
      });
      const existingIds = new Set(existing.map((s) => s.id));
      const sameSet =
        input.stageIds.length === existingIds.size && input.stageIds.every((id) => existingIds.has(id));
      if (!sameSet) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "stageIds must exactly match the workflow's current stages" });
      }

      await Promise.all(
        input.stageIds.map((id, i) =>
          ctx.db.update(workflowStages).set({ position: i, updatedAt: new Date() }).where(eq(workflowStages.id, id)),
        ),
      );

      return { ok: true };
    }),

  setStageStatus: protectedProcedure
    .input(z.object({ stageId: z.string().uuid(), status: stageStatusSchema }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const { workflow } = await findStageAndWorkflowOrThrow(input.stageId, ctx.db);
      await requireManage({ userId, systemRole }, workflow.ownerGroupType, workflow.ownerGroupId, ctx.db);

      const [updated] = await ctx.db
        .update(workflowStages)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(workflowStages.id, input.stageId))
        .returning();

      return updated;
    }),

  attachArtifact: protectedProcedure
    .input(z.object({ stageId: z.string().uuid(), artifactId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const { workflow } = await findStageAndWorkflowOrThrow(input.stageId, ctx.db);
      await requireManage({ userId, systemRole }, workflow.ownerGroupType, workflow.ownerGroupId, ctx.db);

      const artifact = await ctx.db.query.artifacts.findFirst({ where: eq(artifacts.id, input.artifactId) });
      if (!artifact) throw new TRPCError({ code: "NOT_FOUND" });

      // Any kind may attach — this is where kit/skill/prompt participate in
      // the process, alongside doc (spec) and plan (execution). Only gate is
      // the same read-access check used everywhere else.
      const readable = await canAccessArtifact({ userId, systemRole }, artifact, ctx.db);
      if (!readable) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot access this artifact" });

      const [{ maxPos }] = await ctx.db
        .select({ maxPos: sql<number>`coalesce(max(position), -1)` })
        .from(workflowStageArtifacts)
        .where(eq(workflowStageArtifacts.stageId, input.stageId));

      const [row] = await ctx.db
        .insert(workflowStageArtifacts)
        .values({ stageId: input.stageId, artifactId: input.artifactId, position: maxPos + 1 })
        .onConflictDoNothing()
        .returning();

      return row ?? null;
    }),

  detachArtifact: protectedProcedure
    .input(z.object({ stageId: z.string().uuid(), artifactId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const { workflow } = await findStageAndWorkflowOrThrow(input.stageId, ctx.db);
      await requireManage({ userId, systemRole }, workflow.ownerGroupType, workflow.ownerGroupId, ctx.db);

      await ctx.db
        .delete(workflowStageArtifacts)
        .where(and(eq(workflowStageArtifacts.stageId, input.stageId), eq(workflowStageArtifacts.artifactId, input.artifactId)));
    }),
});
