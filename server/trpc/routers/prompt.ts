import { z } from "zod";
import { eq, and, or, desc, sql, inArray, not } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, publicProcedure } from "../trpc";
import { artifacts, artifactVersions, artifactVariables } from "@/server/db/schema";
import { artifactAccessCondition, canAccessArtifact, canMutatePrompt, effectiveGroupRole } from "@/server/auth/access";
import { hybridSearch, fetchArtifactsByIds } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";
import { parseVariables } from "@/server/lib/template";
import type { DbClient } from "@/server/db/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function assertGroupVisibility(ownerType: string, visibility: string | undefined) {
  if (ownerType !== "user" && visibility === "private") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Group prompts cannot be private",
    });
  }
}

/** Sync prompt_variables after body changes. Preserves existing var metadata. */
async function syncVariables(db: DbClient, promptId: string, body: string) {
  const names = parseVariables(body);
  const existing = await db.query.artifactVariables.findMany({
    where: eq(artifactVariables.artifactId, promptId),
  });
  const existingNames = new Set(existing.map((v) => v.name));

  // Remove vars that no longer appear in body
  const toDelete = existing.filter((v) => !names.includes(v.name)).map((v) => v.id);
  if (toDelete.length > 0) {
    await db.delete(artifactVariables).where(inArray(artifactVariables.id, toDelete));
  }

  // Insert new vars
  const toAdd = names.filter((n) => !existingNames.has(n));
  if (toAdd.length > 0) {
    await db.insert(artifactVariables).values(
      toAdd.map((name) => ({ artifactId: promptId, name })),
    );
  }
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
      const existing = await ctx.db.query.artifacts.findFirst({
        where: and(
          eq(artifacts.ownerType, input.ownerType),
          eq(artifacts.ownerId, ownerId),
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
        const role = await effectiveGroupRole(userId, ownerType as "org" | "department" | "team", ownerId, ctx.db);
        if (role !== "editor" && role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      }

      assertGroupVisibility(ownerType, input.visibility);

      // 1. Insert prompt (currentVersionId null until we have the version id)
      const [prompt] = await ctx.db
        .insert(artifacts)
        .values({
          kind: "prompt",
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
        .insert(artifactVersions)
        .values({
          artifactId: prompt.id,
          versionNo: 1,
          body: input.body,
          changelog: input.changelog ?? "Initial version",
          createdBy: userId,
        })
        .returning();

      // 3. Point prompt to version
      const [updated] = await ctx.db
        .update(artifacts)
        .set({ currentVersionId: version.id })
        .where(eq(artifacts.id, prompt.id))
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
        mode: z.enum(["keyword", "hybrid"]).default("hybrid"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      // Forward-compat: the prompt router only lists prompt-kind artifacts.
      const baseCondition = input.mine
        ? and(eq(artifacts.ownerType, "user"), eq(artifacts.ownerId, userId))
        : await artifactAccessCondition(userId, systemRole, ctx.db);
      const condition = and(eq(artifacts.kind, "prompt"), baseCondition);

      const tagFilter = input.tag
        ? sql`${input.tag} = ANY(${artifacts.tags})`
        : undefined;

      // Use hybrid search when a query is provided and mode is hybrid
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
        const items = await fetchArtifactsByIds(ids, ctx.db);
        return { items, total: items.length + input.offset };
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
          with: { versions: { limit: 1, orderBy: desc(artifactVersions.createdAt) } },
        }),
        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(artifacts)
          .where(where),
      ]);

      return { items: rows, total: count };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const prompt = await ctx.db.query.artifacts.findFirst({
        where: and(eq(artifacts.id, input.id), eq(artifacts.kind, "prompt")),
        with: {
          versions: { orderBy: desc(artifactVersions.versionNo) },
          variables: true,
        },
      });
      if (!prompt) throw new TRPCError({ code: "NOT_FOUND" });

      const accessible = await canAccessArtifact({ userId, systemRole }, prompt, ctx.db);
      if (!accessible) throw new TRPCError({ code: "FORBIDDEN" });

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

      const prompt = await ctx.db.query.artifacts.findFirst({
        where: eq(artifacts.id, id),
      });
      if (!prompt) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canMutatePrompt({ userId, systemRole }, prompt, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      assertGroupVisibility(prompt.ownerType, input.visibility);

      // Update metadata
      const metaUpdates = Object.fromEntries(
        Object.entries(meta).filter(([, v]) => v !== undefined),
      );

      if (body !== undefined) {
        // New version
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
        await syncVariables(ctx.db, id, body);
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

      const prompt = await ctx.db.query.artifacts.findFirst({
        where: eq(artifacts.id, input.id),
      });
      if (!prompt) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canMutatePrompt({ userId, systemRole }, prompt, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      await ctx.db.delete(artifacts).where(eq(artifacts.id, input.id));
    }),

  versions: router({
    list: protectedProcedure
      .input(z.object({ promptId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        return ctx.db.query.artifactVersions.findMany({
          where: eq(artifactVersions.artifactId, input.promptId),
          orderBy: desc(artifactVersions.versionNo),
        });
      }),

    get: protectedProcedure
      .input(z.object({ promptId: z.string().uuid(), versionNo: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const { userId, systemRole } = ctx.session;

        // Access check via parent prompt
        const prompt = await ctx.db.query.artifacts.findFirst({
          where: eq(artifacts.id, input.promptId),
          columns: { id: true, visibility: true, ownerType: true, ownerId: true },
        });
        if (!prompt) throw new TRPCError({ code: "NOT_FOUND" });

        const accessible = await canAccessArtifact({ userId, systemRole }, prompt, ctx.db);
        if (!accessible) throw new TRPCError({ code: "FORBIDDEN" });

        const version = await ctx.db.query.artifactVersions.findFirst({
          where: and(
            eq(artifactVersions.artifactId, input.promptId),
            eq(artifactVersions.versionNo, input.versionNo),
          ),
        });
        if (!version) throw new TRPCError({ code: "NOT_FOUND" });
        return version;
      }),
  }),

  rollback: protectedProcedure
    .input(z.object({ promptId: z.string().uuid(), toVersionNo: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const prompt = await ctx.db.query.artifacts.findFirst({
        where: eq(artifacts.id, input.promptId),
      });
      if (!prompt) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canMutatePrompt({ userId, systemRole }, prompt, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      const targetVersion = await ctx.db.query.artifactVersions.findFirst({
        where: and(
          eq(artifactVersions.artifactId, input.promptId),
          eq(artifactVersions.versionNo, input.toVersionNo),
        ),
      });
      if (!targetVersion) throw new TRPCError({ code: "NOT_FOUND", message: "Version not found" });

      const [{ maxNo }] = await ctx.db
        .select({ maxNo: sql<number>`coalesce(max(version_no), 0)` })
        .from(artifactVersions)
        .where(eq(artifactVersions.artifactId, input.promptId));

      const [newVersion] = await ctx.db
        .insert(artifactVersions)
        .values({
          artifactId: input.promptId,
          versionNo: maxNo + 1,
          body: targetVersion.body,
          changelog: `Rolled back to v${input.toVersionNo}`,
          createdBy: userId,
        })
        .returning();

      await syncVariables(ctx.db, input.promptId, targetVersion.body);

      await ctx.db
        .update(artifacts)
        .set({ currentVersionId: newVersion.id, updatedAt: new Date() })
        .where(eq(artifacts.id, input.promptId));

      return { newVersionNo: newVersion.versionNo };
    }),
});
