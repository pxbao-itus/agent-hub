import { z } from "zod";
import { eq, and, or, desc, sql, inArray, not } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, publicProcedure } from "../trpc";
import { prompts, promptVersions, promptVariables, memberships } from "@/server/db/schema";
import { getAccessibleGroups } from "@/server/auth/access";
import { parseVariables } from "@/server/lib/template";
import type { DbClient } from "@/server/db/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Sync prompt_variables after body changes. Preserves existing var metadata. */
async function syncVariables(db: DbClient, promptId: string, body: string) {
  const names = parseVariables(body);
  const existing = await db.query.promptVariables.findMany({
    where: eq(promptVariables.promptId, promptId),
  });
  const existingNames = new Set(existing.map((v) => v.name));

  // Remove vars that no longer appear in body
  const toDelete = existing.filter((v) => !names.includes(v.name)).map((v) => v.id);
  if (toDelete.length > 0) {
    await db.delete(promptVariables).where(inArray(promptVariables.id, toDelete));
  }

  // Insert new vars
  const toAdd = names.filter((n) => !existingNames.has(n));
  if (toAdd.length > 0) {
    await db.insert(promptVariables).values(
      toAdd.map((name) => ({ promptId, name })),
    );
  }
}

/** Build access WHERE for a given userId (personal-first: user owns OR public). */
async function accessCondition(
  userId: string,
  db: DbClient,
  systemRole: "user" | "superadmin",
) {
  if (systemRole === "superadmin") return undefined; // no filter — sees all

  const groups = await getAccessibleGroups(userId, db);

  const groupConditions = groups.map((g) =>
    and(
      eq(prompts.visibility, "group"),
      eq(prompts.ownerType, g.groupType as "org" | "department" | "team"),
      eq(prompts.ownerId, g.groupId),
    ),
  );

  return or(
    eq(prompts.visibility, "public"),
    and(eq(prompts.ownerType, "user"), eq(prompts.ownerId, userId)),
    ...(groupConditions.length > 0 ? groupConditions : [sql`false`]),
  );
}

// ── Router ───────────────────────────────────────────────────────────────────

const visibilityEnum = z.enum(["private", "group", "public"]);
const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens")
  .max(100);

export const promptRouter = router({
  /** Check whether a slug is available within a given owner space. */
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
      const existing = await ctx.db.query.prompts.findFirst({
        where: and(
          eq(prompts.ownerType, input.ownerType),
          eq(prompts.ownerId, ownerId),
          eq(prompts.slug, input.slug),
          input.excludeId ? not(eq(prompts.id, input.excludeId)) : undefined,
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
        tags: z.array(z.string()).default([]),
        visibility: visibilityEnum.default("private"),
        changelog: z.string().max(300).optional(),
        ownerType: z.enum(["user", "org", "department", "team"]).default("user"),
        ownerId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      // Resolve effective owner + verify access
      const ownerType = input.ownerType;
      const ownerId = ownerType === "user" ? userId : (input.ownerId ?? userId);

      if (ownerType !== "user" && systemRole !== "superadmin") {
        const membership = await ctx.db.query.memberships.findFirst({
          where: and(
            eq(memberships.userId, userId),
            eq(memberships.groupType, ownerType as "org" | "department" | "team"),
            eq(memberships.groupId, ownerId),
          ),
        });
        if (!membership) throw new TRPCError({ code: "FORBIDDEN" });
      }

      // 1. Insert prompt (currentVersionId null until we have the version id)
      const [prompt] = await ctx.db
        .insert(prompts)
        .values({
          ownerType,
          ownerId,
          title: input.title,
          slug: input.slug ?? null,
          description: input.description,
          tags: input.tags,
          visibility: input.visibility,
          createdBy: userId,
        })
        .returning();

      // 2. Insert first version
      const [version] = await ctx.db
        .insert(promptVersions)
        .values({
          promptId: prompt.id,
          versionNo: 1,
          body: input.body,
          changelog: input.changelog ?? "Initial version",
          createdBy: userId,
        })
        .returning();

      // 3. Point prompt to version
      const [updated] = await ctx.db
        .update(prompts)
        .set({ currentVersionId: version.id })
        .where(eq(prompts.id, prompt.id))
        .returning();

      // 4. Sync variables
      await syncVariables(ctx.db, prompt.id, input.body);

      return updated;
    }),

  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        query: z.string().optional(),
        tag: z.string().optional(),
        mine: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const condition = input.mine
        ? and(eq(prompts.ownerType, "user"), eq(prompts.ownerId, userId))
        : await accessCondition(userId, ctx.db, systemRole);

      const ftsFilter = input.query
        ? sql`to_tsvector('english', ${prompts.title} || ' ' || coalesce(${prompts.description}, '')) @@ plainto_tsquery('english', ${input.query})`
        : undefined;

      const tagFilter = input.tag
        ? sql`${input.tag} = ANY(${prompts.tags})`
        : undefined;

      const where = and(condition, ftsFilter, tagFilter);

      const [rows, [{ count }]] = await Promise.all([
        ctx.db.query.prompts.findMany({
          where,
          orderBy: desc(prompts.updatedAt),
          limit: input.limit,
          offset: input.offset,
          with: { versions: { limit: 1, orderBy: desc(promptVersions.createdAt) } },
        }),
        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(prompts)
          .where(where),
      ]);

      return { items: rows, total: count };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const prompt = await ctx.db.query.prompts.findFirst({
        where: eq(prompts.id, input.id),
        with: {
          versions: { orderBy: desc(promptVersions.versionNo) },
          variables: true,
        },
      });
      if (!prompt) throw new TRPCError({ code: "NOT_FOUND" });

      // Access check
      if (systemRole !== "superadmin" && prompt.visibility !== "public") {
        if (prompt.ownerType === "user" && prompt.ownerId === userId) {
          // owner — allowed
        } else if (prompt.visibility === "group") {
          const groups = await getAccessibleGroups(userId, ctx.db);
          const allowed = groups.some(
            (g) => g.groupType === prompt.ownerType && g.groupId === prompt.ownerId,
          );
          if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });
        } else {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      }

      return prompt;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        slug: slugSchema.nullable().optional(),
        description: z.string().max(500).nullable().optional(),
        body: z.string().min(1).optional(),
        tags: z.array(z.string()).optional(),
        visibility: visibilityEnum.optional(),
        changelog: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const { id, body, changelog, ...meta } = input;

      const prompt = await ctx.db.query.prompts.findFirst({
        where: eq(prompts.id, id),
      });
      if (!prompt) throw new TRPCError({ code: "NOT_FOUND" });

      const isOwner = prompt.ownerType === "user" && prompt.ownerId === userId;
      if (!isOwner && systemRole !== "superadmin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // Update metadata
      const metaUpdates = Object.fromEntries(
        Object.entries(meta).filter(([, v]) => v !== undefined),
      );

      if (body !== undefined) {
        // New version
        const [{ maxNo }] = await ctx.db
          .select({ maxNo: sql<number>`coalesce(max(version_no), 0)` })
          .from(promptVersions)
          .where(eq(promptVersions.promptId, id));

        const [version] = await ctx.db
          .insert(promptVersions)
          .values({
            promptId: id,
            versionNo: maxNo + 1,
            body,
            changelog: changelog ?? `Version ${maxNo + 1}`,
            createdBy: userId,
          })
          .returning();

        metaUpdates.currentVersionId = version.id;
        await syncVariables(ctx.db, id, body);
      }

      const [updated] = await ctx.db
        .update(prompts)
        .set({ ...metaUpdates, updatedAt: new Date() })
        .where(eq(prompts.id, id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const prompt = await ctx.db.query.prompts.findFirst({
        where: eq(prompts.id, input.id),
      });
      if (!prompt) throw new TRPCError({ code: "NOT_FOUND" });

      const isOwner = prompt.ownerType === "user" && prompt.ownerId === userId;
      if (!isOwner && systemRole !== "superadmin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await ctx.db.delete(prompts).where(eq(prompts.id, input.id));
    }),

  versions: router({
    list: protectedProcedure
      .input(z.object({ promptId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        return ctx.db.query.promptVersions.findMany({
          where: eq(promptVersions.promptId, input.promptId),
          orderBy: desc(promptVersions.versionNo),
        });
      }),
  }),
});
