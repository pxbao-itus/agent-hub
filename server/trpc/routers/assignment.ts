import { z } from "zod";
import { eq, and, or, ilike, inArray, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { artifacts, auditEvents, users } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";
import { canAccessArtifact, canMutatePrompt } from "@/server/auth/access";
import { getAssignments, setAssigner, addAssignee, removeAssignee } from "@/server/services/assignment";

const ASSIGNMENT_AUDIT_ACTIONS = [
  "assignment.assigner.change",
  "assignment.assignee.add",
  "assignment.assignee.remove",
] as const;

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

      const { assignerId, assigneeIds } = await getAssignments(artifact, ctx.db);
      const userIds = [...new Set([assignerId, ...assigneeIds].filter((id): id is string => !!id))];
      const rows = userIds.length
        ? await ctx.db.query.users.findMany({
            where: inArray(users.id, userIds),
            columns: { id: true, name: true, email: true, image: true },
          })
        : [];
      const byId = new Map(rows.map((u) => [u.id, u]));

      return {
        assigner: assignerId ? (byId.get(assignerId) ?? null) : null,
        assignees: assigneeIds.flatMap((id) => {
          const u = byId.get(id);
          return u ? [u] : [];
        }),
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
