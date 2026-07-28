import { z } from "zod";
import { eq, and, or, ilike, inArray, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { artifacts, auditEvents, users } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";
import { canAccessArtifact, canMutatePrompt } from "@/server/auth/access";
import {
  addAssignee,
  canUpdateAssignmentStatus,
  getAssignmentDetail,
  isCurrentAssignee,
  removeAssignee,
  setAssigner,
  updateWorkItem,
} from "@/server/services/assignment";
import { countMyWork, listMyWork } from "@/server/services/my-work";

const ASSIGNMENT_AUDIT_ACTIONS = [
  "assignment.assigner.change",
  "assignment.assignee.add",
  "assignment.assignee.remove",
  "assignment.status.change",
  "assignment.priority.change",
  "assignment.due_date.change",
] as const;

const assignmentStatusSchema = z.enum(["open", "in_progress", "blocked", "done"]);
const assignmentPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

async function findAssignable(id: string, db: DbClient) {
  const artifact = await db.query.artifacts.findFirst({ where: eq(artifacts.id, id) });
  if (!artifact) throw new TRPCError({ code: "NOT_FOUND" });
  if (artifact.kind !== "doc" && artifact.kind !== "plan") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only docs and plans support assignment." });
  }
  return artifact;
}

export const assignmentRouter = router({
  /** Current assigner + assignees for a doc/plan, resolved to displayable user rows. */
  get: protectedProcedure
    .input(z.object({ artifactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const artifact = await findAssignable(input.artifactId, ctx.db);
      const readable = await canAccessArtifact({ userId, systemRole }, artifact, ctx.db);
      if (!readable) throw new TRPCError({ code: "FORBIDDEN" });

      const { assignerId, assigneeIds, workItem } = await getAssignmentDetail(artifact, ctx.db);
      const userIds = [...new Set([assignerId, ...assigneeIds].filter((id): id is string => !!id))];
      const rows = userIds.length
        ? await ctx.db.query.users.findMany({
            where: inArray(users.id, userIds),
            columns: { id: true, name: true, email: true, image: true },
          })
        : [];
      const byId = new Map(rows.map((u) => [u.id, u]));

      const canManage = await canMutatePrompt({ userId, systemRole }, artifact, ctx.db);
      const canUpdateStatus = await canUpdateAssignmentStatus({ userId, systemRole }, artifact, ctx.db);
      const isCurrentUserAssignee = await isCurrentAssignee(artifact.id, userId, ctx.db);

      return {
        assigner: assignerId ? (byId.get(assignerId) ?? null) : null,
        assignees: assigneeIds.flatMap((id) => {
          const u = byId.get(id);
          return u ? [u] : [];
        }),
        ...workItem,
        canManage,
        canUpdateStatus,
        isCurrentUserAssignee,
      };
    }),

  listMyWork: protectedProcedure
    .input(
      z.object({
        view: z.enum(["assigned_to_me", "coordinated_by_me", "unassigned"]).default("assigned_to_me"),
        kind: z.enum(["doc", "plan"]).optional(),
        status: z.array(assignmentStatusSchema).max(4).optional(),
        priority: z.array(assignmentPrioritySchema).max(4).optional(),
        due: z.enum(["overdue", "today", "next_7_days", "no_due_date"]).optional(),
        projectId: z.string().uuid().optional(),
        query: z.string().trim().max(200).optional(),
        sort: z.enum(["due_date", "priority", "updated"]).default("due_date"),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const actor = { userId: ctx.session.userId, systemRole: ctx.session.systemRole };
      const [result, assignedToMe, coordinatedByMe, unassigned] = await Promise.all([
        listMyWork(actor, input, ctx.db),
        countMyWork(actor, "assigned_to_me", ctx.db),
        countMyWork(actor, "coordinated_by_me", ctx.db),
        countMyWork(actor, "unassigned", ctx.db),
      ]);
      return {
        ...result,
        counts: { assignedToMe, coordinatedByMe, unassigned },
      };
    }),

  /**
   * User search scoped to "would this pick actually succeed" — filters
   * user.search-style text matches down to users who can already view this
   * artifact (assignment never grants visibility, see requireTargetCanView
   * in the service), so the picker never offers someone who'd be rejected on
   * save. Over-fetches text matches, then checks each with the same
   * canAccessArtifact used to enforce the rule, stopping once `limit` pass.
   */
  searchCandidates: protectedProcedure
    .input(
      z.object({
        artifactId: z.string().uuid(),
        query: z.string().min(2).max(100),
        limit: z.number().int().min(1).max(20).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const artifact = await findAssignable(input.artifactId, ctx.db);
      const readable = await canAccessArtifact({ userId, systemRole }, artifact, ctx.db);
      if (!readable) throw new TRPCError({ code: "FORBIDDEN" });

      const q = `%${input.query}%`;
      const candidates = await ctx.db
        .select({ id: users.id, name: users.name, email: users.email, image: users.image, systemRole: users.systemRole })
        .from(users)
        .where(or(ilike(users.name, q), ilike(users.email, q)))
        .limit(input.limit * 5);

      const result: { id: string; name: string | null; email: string; image: string | null }[] = [];
      for (const c of candidates) {
        if (result.length >= input.limit) break;
        const ok = await canAccessArtifact({ userId: c.id, systemRole: c.systemRole }, artifact, ctx.db);
        if (ok) result.push({ id: c.id, name: c.name, email: c.email, image: c.image });
      }
      return result;
    }),

  setAssigner: protectedProcedure
    .input(z.object({ artifactId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId: actorId, systemRole } = ctx.session;
      const artifact = await findAssignable(input.artifactId, ctx.db);
      const allowed = await canMutatePrompt({ userId: actorId, systemRole }, artifact, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      const result = await setAssigner(artifact, input.userId, actorId, ctx.db);
      if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      return result;
    }),

  addAssignee: protectedProcedure
    .input(z.object({ artifactId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId: actorId, systemRole } = ctx.session;
      const artifact = await findAssignable(input.artifactId, ctx.db);
      const allowed = await canMutatePrompt({ userId: actorId, systemRole }, artifact, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      const result = await addAssignee(artifact, input.userId, actorId, ctx.db);
      if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      return result;
    }),

  assignToMe: protectedProcedure
    .input(z.object({ artifactId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const artifact = await findAssignable(input.artifactId, ctx.db);
      if (!(await canAccessArtifact({ userId, systemRole }, artifact, ctx.db))) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const result = await addAssignee(artifact, userId, userId, ctx.db);
      if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      return result;
    }),

  bulkAddAssignee: protectedProcedure
    .input(
      z.object({
        artifactIds: z.array(z.string().uuid()).min(1).max(50),
        userId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actor = { userId: ctx.session.userId, systemRole: ctx.session.systemRole };
      const assigned: string[] = [];
      const alreadyAssigned: string[] = [];
      const failed: Array<{ artifactId: string; reason: string }> = [];

      for (const artifactId of [...new Set(input.artifactIds)]) {
        const artifact = await ctx.db.query.artifacts.findFirst({ where: eq(artifacts.id, artifactId) });
        if (!artifact || (artifact.kind !== "doc" && artifact.kind !== "plan")) {
          failed.push({ artifactId, reason: "Doc or Plan not found." });
          continue;
        }
        if (!(await canMutatePrompt(actor, artifact, ctx.db))) {
          failed.push({ artifactId, reason: "You cannot manage this artifact." });
          continue;
        }
        const result = await addAssignee(artifact, input.userId, actor.userId, ctx.db);
        if (!result.ok) {
          failed.push({ artifactId, reason: result.message });
        } else if (result.alreadyAssigned) {
          alreadyAssigned.push(artifactId);
        } else {
          assigned.push(artifactId);
        }
      }
      return { assigned, alreadyAssigned, failed };
    }),

  removeAssignee: protectedProcedure
    .input(z.object({ artifactId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId: actorId, systemRole } = ctx.session;
      const artifact = await findAssignable(input.artifactId, ctx.db);
      const allowed = await canMutatePrompt({ userId: actorId, systemRole }, artifact, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      const result = await removeAssignee(artifact, input.userId, actorId, ctx.db);
      if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      return result;
    }),

  updateWorkItem: protectedProcedure
    .input(
      z
        .object({
          artifactId: z.string().uuid(),
          status: assignmentStatusSchema.optional(),
          priority: assignmentPrioritySchema.optional(),
          dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        })
        .refine(
          (input) => input.status !== undefined || input.priority !== undefined || input.dueDate !== undefined,
          { message: "At least one work-item field is required." },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const artifact = await findAssignable(input.artifactId, ctx.db);
      const result = await updateWorkItem(
        artifact,
        { status: input.status, priority: input.priority, dueDate: input.dueDate },
        { userId: ctx.session.userId, systemRole: ctx.session.systemRole },
        ctx.db,
      );
      if (!result.ok) {
        throw new TRPCError({
          code: result.message.startsWith("Due date") ? "BAD_REQUEST" : "FORBIDDEN",
          message: result.message,
        });
      }
      return result;
    }),

  /** Assignment-only slice of the audit trail for this artifact — anyone who can view the artifact can view its history. */
  history: protectedProcedure
    .input(z.object({ artifactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const artifact = await findAssignable(input.artifactId, ctx.db);
      const readable = await canAccessArtifact({ userId, systemRole }, artifact, ctx.db);
      if (!readable) throw new TRPCError({ code: "FORBIDDEN" });

      return ctx.db
        .select({
          id: auditEvents.id,
          action: auditEvents.action,
          metadata: auditEvents.metadata,
          createdAt: auditEvents.createdAt,
          actorId: auditEvents.actorId,
          actorName: users.name,
          actorEmail: users.email,
        })
        .from(auditEvents)
        .leftJoin(users, eq(auditEvents.actorId, users.id))
        .where(
          and(
            eq(auditEvents.targetType, "artifact"),
            eq(auditEvents.targetId, input.artifactId),
            inArray(auditEvents.action, ASSIGNMENT_AUDIT_ACTIONS),
          ),
        )
        .orderBy(desc(auditEvents.createdAt));
    }),
});
