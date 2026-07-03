import { z } from "zod";
import { eq, and, desc, sql, not, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import {
  artifacts,
  artifactVersions,
  artifactTasks,
} from "@/server/db/schema";
import {
  artifactAccessCondition,
  canAccessArtifact,
  canMutatePrompt,
  effectiveGroupRole,
} from "@/server/auth/access";
import { createPlan } from "@/server/services/plan";
import { rollbackVersion } from "@/server/services/version";
import { notifyVersionChange } from "@/server/services/notification";
import { hybridSearch } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";
import type { DbClient } from "@/server/db/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function assertGroupVisibility(ownerType: string, visibility: string | undefined) {
  if (ownerType !== "user" && visibility === "private") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Group plans cannot be private",
    });
  }
}

const taskInputSchema = z.object({
  id: z.string().uuid().optional(),
  content: z.string().min(1).max(2000),
  status: z.enum(["todo", "doing", "done"]).optional(),
  position: z.number().int().min(0).optional(),
});

// ── Schemas ───────────────────────────────────────────────────────────────────

const visibilityEnum = z.enum(["private", "group", "public"]);
const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens")
  .max(100);

// ── Router ────────────────────────────────────────────────────────────────────

export const planRouter = router({
  checkSlug: protectedProcedure
    .input(
      z.object({
        slug: slugSchema,
        ownerType: z.enum(["user", "org", "department", "team"]).default("user"),
        ownerId: z.string().uuid().optional(),
        excludeId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const ownerId =
        input.ownerType === "user" ? ctx.session.userId : (input.ownerId ?? ctx.session.userId);
      const existing = await ctx.db.query.artifacts.findFirst({
        where: and(
          eq(artifacts.ownerType, input.ownerType),
          eq(artifacts.ownerId, ownerId),
          eq(artifacts.kind, "plan"),
          eq(artifacts.slug, input.slug),
          input.excludeId ? not(eq(artifacts.id, input.excludeId)) : undefined,
        ),
        columns: { id: true },
      });
      return { available: !existing };
    }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        slug: slugSchema.optional(),
        description: z.string().max(500).optional(),
        body: z.string().min(1),
        tasks: z.array(taskInputSchema).default([]),
        tags: z.array(z.string()).default([]),
        visibility: visibilityEnum.default("private"),
        changelog: z.string().max(300).optional(),
        ownerType: z.enum(["user", "org", "department", "team"]).default("user"),
        ownerId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const ownerType = input.ownerType;
      const ownerId = ownerType === "user" ? userId : (input.ownerId ?? userId);

      if (ownerType !== "user" && systemRole !== "superadmin") {
        const role = await effectiveGroupRole(
          userId,
          ownerType as "org" | "department" | "team",
          ownerId,
          ctx.db,
        );
        if (role !== "editor" && role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      }

      assertGroupVisibility(ownerType, input.visibility);

      return createPlan(
        {
          ownerType,
          ownerId,
          title: input.title,
          slug: input.slug,
          description: input.description,
          body: input.body,
          tasks: input.tasks,
          tags: input.tags,
          visibility: input.visibility,
          changelog: input.changelog,
          createdBy: userId,
        },
        ctx.db,
      );
    }),

  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        query: z.string().optional(),
        tag: z.string().optional(),
        mine: z.boolean().default(false),
        mode: z.enum(["keyword", "hybrid"]).default("hybrid"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const baseCondition = input.mine
        ? and(eq(artifacts.ownerType, "user"), eq(artifacts.ownerId, userId))
        : await artifactAccessCondition(userId, systemRole, ctx.db);
      const condition = and(eq(artifacts.kind, "plan"), baseCondition);

      const tagFilter = input.tag
        ? sql`${input.tag} = ANY(${artifacts.tags})`
        : undefined;

      const withTaskProgress = <T extends { tasks?: { status: string }[] }>(r: T) => {
        const tasks = r.tasks ?? [];
        const done = tasks.filter((t) => t.status === "done").length;
        return { ...r, taskProgress: { done, total: tasks.length } };
      };

      if (input.query && input.mode === "hybrid") {
        const { ids } = await hybridSearch({
          query: input.query,
          accessCondition: condition,
          tagFilter,
          embedder: getEmbedder(),
          db: ctx.db,
          limit: input.limit,
          offset: input.offset,
        });
        if (!ids.length) return { items: [], total: input.offset };
        const found = await ctx.db.query.artifacts.findMany({
          where: inArray(artifacts.id, ids),
          with: { tasks: { orderBy: artifactTasks.position } },
        });
        const byId = new Map(found.map((r) => [r.id, r]));
        const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as typeof found;
        return { items: ordered.map(withTaskProgress), total: ordered.length + input.offset };
      }

      const ftsFilter = input.query
        ? sql`to_tsvector('english', ${artifacts.title} || ' ' || coalesce(${artifacts.description}, '')) @@ plainto_tsquery('english', ${input.query})`
        : undefined;

      const where = and(condition, ftsFilter, tagFilter);

      const [rows, [{ count }]] = await Promise.all([
        ctx.db.query.artifacts.findMany({
          where,
          orderBy: desc(artifacts.updatedAt),
          limit: input.limit,
          offset: input.offset,
          with: { tasks: { orderBy: artifactTasks.position } },
        }),
        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(artifacts)
          .where(where),
      ]);

      const items = rows.map(withTaskProgress);

      return { items, total: count };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const plan = await ctx.db.query.artifacts.findFirst({
        where: and(eq(artifacts.id, input.id), eq(artifacts.kind, "plan")),
        with: {
          versions: { orderBy: desc(artifactVersions.versionNo) },
          tasks: { orderBy: artifactTasks.position },
        },
      });
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });

      const accessible = await canAccessArtifact({ userId, systemRole }, plan, ctx.db);
      if (!accessible) throw new TRPCError({ code: "FORBIDDEN" });

      const tasks = plan.tasks ?? [];
      const done = tasks.filter((t) => t.status === "done").length;
      return { ...plan, taskProgress: { done, total: tasks.length } };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        slug: slugSchema.nullable().optional(),
        description: z.string().max(500).nullable().optional(),
        body: z.string().min(1).optional(),
        tasks: z.array(taskInputSchema).optional(),
        tags: z.array(z.string()).optional(),
        visibility: visibilityEnum.optional(),
        changelog: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const { id, body, changelog, tasks, ...meta } = input;

      const plan = await ctx.db.query.artifacts.findFirst({
        where: and(eq(artifacts.id, id), eq(artifacts.kind, "plan")),
      });
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canMutatePrompt({ userId, systemRole }, plan, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      assertGroupVisibility(plan.ownerType, input.visibility);

      const metaUpdates = Object.fromEntries(
        Object.entries(meta).filter(([, v]) => v !== undefined),
      );

      if (body !== undefined) {
        const [{ maxNo }] = await ctx.db
          .select({ maxNo: sql<number>`coalesce(max(version_no), 0)` })
          .from(artifactVersions)
          .where(eq(artifactVersions.artifactId, id));

        const [version] = await ctx.db
          .insert(artifactVersions)
          .values({
            artifactId: id,
            versionNo: maxNo + 1,
            body,
            changelog: changelog ?? `Version ${maxNo + 1}`,
            createdBy: userId,
          })
          .returning();

        metaUpdates.currentVersionId = version.id;
        await notifyVersionChange(id, version.id, userId, ctx.db);
      }

      // Diff tasks by id: update existing, insert new, delete removed.
      if (tasks !== undefined) {
        const existing = await ctx.db.query.artifactTasks.findMany({
          where: eq(artifactTasks.artifactId, id),
        });
        const existingById = new Map(existing.map((t) => [t.id, t]));

        const inputWithId = tasks.filter((t) => t.id);
        const inputWithIdSet = new Set(inputWithId.map((t) => t.id!));
        const toDelete = existing.filter((t) => !inputWithIdSet.has(t.id));

        if (toDelete.length > 0) {
          await ctx.db
            .delete(artifactTasks)
            .where(inArray(artifactTasks.id, toDelete.map((t) => t.id)));
        }

        for (const [i, t] of tasks.entries()) {
          const pos = t.position ?? i;
          if (t.id && existingById.has(t.id)) {
            await ctx.db
              .update(artifactTasks)
              .set({
                content: t.content,
                position: pos,
                ...(t.status !== undefined ? { status: t.status } : {}),
                updatedAt: new Date(),
              })
              .where(eq(artifactTasks.id, t.id));
          } else if (!t.id) {
            await ctx.db.insert(artifactTasks).values({
              artifactId: id,
              content: t.content,
              status: t.status ?? "todo",
              position: pos,
            });
          }
        }
      }

      const [updated] = await ctx.db
        .update(artifacts)
        .set({ ...metaUpdates, updatedAt: new Date() })
        .where(eq(artifacts.id, id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const plan = await ctx.db.query.artifacts.findFirst({
        where: and(eq(artifacts.id, input.id), eq(artifacts.kind, "plan")),
      });
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canMutatePrompt({ userId, systemRole }, plan, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      await ctx.db.delete(artifacts).where(eq(artifacts.id, input.id));
    }),

  rollback: protectedProcedure
    .input(z.object({ id: z.string().uuid(), toVersionNo: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const plan = await ctx.db.query.artifacts.findFirst({
        where: and(eq(artifacts.id, input.id), eq(artifacts.kind, "plan")),
      });
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canMutatePrompt({ userId, systemRole }, plan, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      const { newVersionNo } = await rollbackVersion(input.id, input.toVersionNo, userId, ctx.db);
      return { newVersionNo };
    }),

  setTaskStatus: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        status: z.enum(["todo", "doing", "done"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const task = await ctx.db.query.artifactTasks.findFirst({
        where: eq(artifactTasks.id, input.taskId),
      });
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });

      const plan = await ctx.db.query.artifacts.findFirst({
        where: and(eq(artifacts.id, task.artifactId), eq(artifacts.kind, "plan")),
      });
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canMutatePrompt({ userId, systemRole }, plan, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      await ctx.db
        .update(artifactTasks)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(artifactTasks.id, input.taskId));

      return { taskId: input.taskId, status: input.status };
    }),

  reorderTasks: protectedProcedure
    .input(
      z.object({
        planId: z.string().uuid(),
        taskIds: z.array(z.string().uuid()).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const plan = await ctx.db.query.artifacts.findFirst({
        where: and(eq(artifacts.id, input.planId), eq(artifacts.kind, "plan")),
      });
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canMutatePrompt({ userId, systemRole }, plan, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      const existing = await ctx.db.query.artifactTasks.findMany({
        where: eq(artifactTasks.artifactId, input.planId),
        columns: { id: true },
      });
      const existingIds = new Set(existing.map((t) => t.id));
      const sameSet =
        input.taskIds.length === existingIds.size && input.taskIds.every((id) => existingIds.has(id));
      if (!sameSet) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "taskIds must exactly match the plan's current tasks" });
      }

      await Promise.all(
        input.taskIds.map((id, i) =>
          ctx.db.update(artifactTasks).set({ position: i, updatedAt: new Date() }).where(eq(artifactTasks.id, id)),
        ),
      );

      return { ok: true };
    }),
});
