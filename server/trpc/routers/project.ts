import { z } from "zod";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { projects, projectArtifacts, projectMembers, artifacts, users } from "@/server/db/schema";
import { getAccessibleGroups, canAccessArtifact } from "@/server/auth/access";
import {
  canViewProject,
  canManageProject,
  attachProjectCounts,
  attachProjectManageFlags,
  type GroupType,
  type SessionUser,
} from "@/server/lib/project-access";
import { recordAudit } from "@/server/services/audit";
import type { DbClient } from "@/server/db/types";

const groupTypeSchema = z.enum(["org", "department", "team"]);

async function requireManage(
  user: SessionUser,
  ownerGroupType: GroupType,
  ownerGroupId: string,
  db: DbClient,
) {
  const allowed = await canManageProject(user, ownerGroupType, ownerGroupId, db);
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });
}

async function findProjectOrThrow(id: string, db: DbClient) {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, id) });
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  return project;
}

export const projectRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        ownerGroupType: groupTypeSchema,
        ownerGroupId: z.string().uuid(),
        name: z.string().min(1).max(200),
        description: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      await requireManage({ userId, systemRole }, input.ownerGroupType, input.ownerGroupId, ctx.db);

      const [project] = await ctx.db
        .insert(projects)
        .values({
          ownerGroupType: input.ownerGroupType,
          ownerGroupId: input.ownerGroupId,
          name: input.name,
          description: input.description,
          createdBy: userId,
        })
        .returning();

      return project;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(500).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const { id, ...meta } = input;

      const project = await findProjectOrThrow(id, ctx.db);
      await requireManage({ userId, systemRole }, project.ownerGroupType, project.ownerGroupId, ctx.db);

      const metaUpdates = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));

      const [updated] = await ctx.db
        .update(projects)
        .set({ ...metaUpdates, updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const project = await findProjectOrThrow(input.id, ctx.db);
      await requireManage({ userId, systemRole }, project.ownerGroupType, project.ownerGroupId, ctx.db);

      // Cascades to project_artifacts/project_members only — the underlying
      // doc/plan artifacts and users are untouched (plan §7.4).
      await ctx.db.delete(projects).where(eq(projects.id, input.id));
    }),

  /** Every project the caller can see (cone over the owning group), newest first. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const { userId, systemRole } = ctx.session;

    let where;
    if (systemRole !== "superadmin") {
      const groups = await getAccessibleGroups(userId, ctx.db);
      if (!groups.length) return [];
      where = or(
        ...groups.map((g) => and(eq(projects.ownerGroupType, g.groupType), eq(projects.ownerGroupId, g.groupId))),
      );
    }

    const rows = await ctx.db.query.projects.findMany({ where, orderBy: desc(projects.updatedAt) });
    if (!rows.length) return [];

    const withCounts = await attachProjectCounts(rows, ctx.db);
    return attachProjectManageFlags(withCounts, { userId, systemRole }, ctx.db);
  }),

  /** Projects the caller is a member of — powers "My projects" surfaces. */
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const { userId, systemRole } = ctx.session;

    const rows = await ctx.db
      .select({ project: projects })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(eq(projectMembers.userId, userId))
      .orderBy(desc(projects.updatedAt));

    const list = rows.map((r) => r.project);
    if (!list.length) return [];

    const withCounts = await attachProjectCounts(list, ctx.db);
    return attachProjectManageFlags(withCounts, { userId, systemRole }, ctx.db);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const project = await findProjectOrThrow(input.id, ctx.db);

      const viewable = await canViewProject({ userId, systemRole }, project, ctx.db);
      if (!viewable) throw new TRPCError({ code: "FORBIDDEN" });

      const [canManage, assigned, memberRows] = await Promise.all([
        canManageProject({ userId, systemRole }, project.ownerGroupType, project.ownerGroupId, ctx.db),
        ctx.db
          .select({ artifact: artifacts })
          .from(projectArtifacts)
          .innerJoin(artifacts, eq(projectArtifacts.artifactId, artifacts.id))
          .where(eq(projectArtifacts.projectId, project.id)),
        ctx.db
          .select({ id: users.id, name: users.name, email: users.email, image: users.image })
          .from(projectMembers)
          .innerJoin(users, eq(projectMembers.userId, users.id))
          .where(eq(projectMembers.projectId, project.id)),
      ]);

      // Filter assigned artifacts to what the viewer can actually read — a
      // project is organizational, it never grants artifact access itself.
      const readable = [];
      for (const { artifact } of assigned) {
        const ok = await canAccessArtifact({ userId, systemRole }, artifact, ctx.db);
        if (ok) readable.push(artifact);
      }

      return { ...project, canManage, artifacts: readable, members: memberRows };
    }),

  /** Projects a given artifact belongs to, filtered to what the caller can see. */
  listForArtifact: protectedProcedure
    .input(z.object({ artifactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const rows = await ctx.db
        .select({ project: projects })
        .from(projectArtifacts)
        .innerJoin(projects, eq(projectArtifacts.projectId, projects.id))
        .where(eq(projectArtifacts.artifactId, input.artifactId));

      const viewable = [];
      for (const { project } of rows) {
        const ok = await canViewProject({ userId, systemRole }, project, ctx.db);
        if (ok) viewable.push(project);
      }
      if (!viewable.length) return [];

      return attachProjectManageFlags(viewable, { userId, systemRole }, ctx.db);
    }),

  assignArtifact: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), artifactId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const project = await findProjectOrThrow(input.projectId, ctx.db);
      await requireManage({ userId, systemRole }, project.ownerGroupType, project.ownerGroupId, ctx.db);

      const artifact = await ctx.db.query.artifacts.findFirst({ where: eq(artifacts.id, input.artifactId) });
      if (!artifact) throw new TRPCError({ code: "NOT_FOUND" });
      if (artifact.kind !== "doc" && artifact.kind !== "plan") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only docs and plans can be assigned to a project" });
      }
      const readable = await canAccessArtifact({ userId, systemRole }, artifact, ctx.db);
      if (!readable) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot access this artifact" });

      const [row] = await ctx.db
        .insert(projectArtifacts)
        .values({ projectId: input.projectId, artifactId: input.artifactId })
        .onConflictDoNothing()
        .returning();

      if (row) {
        await recordAudit(
          {
            actorId: userId,
            action: "project.artifact.add",
            targetType: "artifact",
            targetId: input.artifactId,
            metadata: { projectId: project.id, projectName: project.name },
          },
          ctx.db,
        );
      }
      return row ?? null;
    }),

  /**
   * Bulk assign ("add to project" bulk action). Same
   * per-item rules as `assignArtifact` (kind doc|plan + readable), applied
   * across the batch — items failing either check are skipped and
   * reported rather than failing the whole call.
   */
  assignArtifactsBulk: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), artifactIds: z.array(z.string().uuid()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const project = await findProjectOrThrow(input.projectId, ctx.db);
      await requireManage({ userId, systemRole }, project.ownerGroupType, project.ownerGroupId, ctx.db);

      const rows = await ctx.db.query.artifacts.findMany({ where: inArray(artifacts.id, input.artifactIds) });
      const rowById = new Map(rows.map((a) => [a.id, a]));

      const assignedIds: string[] = [];
      const skippedIds: string[] = [];
      for (const id of input.artifactIds) {
        const artifact = rowById.get(id);
        if (!artifact || (artifact.kind !== "doc" && artifact.kind !== "plan")) {
          skippedIds.push(id);
          continue;
        }
        const readable = await canAccessArtifact({ userId, systemRole }, artifact, ctx.db);
        if (!readable) {
          skippedIds.push(id);
          continue;
        }
        assignedIds.push(id);
      }

      if (assignedIds.length > 0) {
        const inserted = await ctx.db
          .insert(projectArtifacts)
          .values(assignedIds.map((artifactId) => ({ projectId: input.projectId, artifactId })))
          .onConflictDoNothing()
          .returning({ artifactId: projectArtifacts.artifactId });
        await Promise.all(
          inserted.map(({ artifactId }) =>
            recordAudit(
              {
                actorId: userId,
                action: "project.artifact.add",
                targetType: "artifact",
                targetId: artifactId,
                metadata: { projectId: project.id, projectName: project.name },
              },
              ctx.db,
            ),
          ),
        );
      }

      return { assignedIds, skippedIds };
    }),

  unassignArtifact: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), artifactId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const project = await findProjectOrThrow(input.projectId, ctx.db);
      await requireManage({ userId, systemRole }, project.ownerGroupType, project.ownerGroupId, ctx.db);

      const [removed] = await ctx.db
        .delete(projectArtifacts)
        .where(and(eq(projectArtifacts.projectId, input.projectId), eq(projectArtifacts.artifactId, input.artifactId)))
        .returning({ artifactId: projectArtifacts.artifactId });
      if (removed) {
        await recordAudit(
          {
            actorId: userId,
            action: "project.artifact.remove",
            targetType: "artifact",
            targetId: input.artifactId,
            metadata: { projectId: project.id, projectName: project.name },
          },
          ctx.db,
        );
      }
    }),

  addMember: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const project = await findProjectOrThrow(input.projectId, ctx.db);
      await requireManage({ userId, systemRole }, project.ownerGroupType, project.ownerGroupId, ctx.db);

      // Target must be able to see the project themselves (in the owning
      // group's cone) — otherwise "member" would list someone with no way to
      // actually open it. Relaxing this to "add anyone" is a one-line change
      // if ever wanted (plan §7.1).
      const targetGroups = await getAccessibleGroups(input.userId, ctx.db);
      const inCone = targetGroups.some(
        (g) => g.groupType === project.ownerGroupType && g.groupId === project.ownerGroupId,
      );
      if (!inCone) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "User is not in the owning group's scope" });
      }

      const [row] = await ctx.db
        .insert(projectMembers)
        .values({ projectId: input.projectId, userId: input.userId })
        .onConflictDoNothing()
        .returning();

      await recordAudit(
        { actorId: userId, action: "project.member.add", targetType: "project", targetId: input.projectId, metadata: { memberUserId: input.userId } },
        ctx.db,
      );

      return row ?? null;
    }),

  removeMember: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const project = await findProjectOrThrow(input.projectId, ctx.db);
      await requireManage({ userId, systemRole }, project.ownerGroupType, project.ownerGroupId, ctx.db);

      await ctx.db
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.userId)));

      await recordAudit(
        { actorId: userId, action: "project.member.remove", targetType: "project", targetId: input.projectId, metadata: { memberUserId: input.userId } },
        ctx.db,
      );
    }),
});
