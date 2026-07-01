import { z } from "zod";
import { eq, and, desc, sql, not, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { artifacts, artifactVersions } from "@/server/db/schema";
import { hybridSearch } from "@/server/lib/search";
import { getEmbedder } from "@/server/embedder";
import { rollbackVersion } from "@/server/services/version";
import {
  artifactAccessCondition,
  canAccessArtifact,
  canMutatePrompt,
  effectiveGroupRole,
} from "@/server/auth/access";

function assertGroupVisibility(ownerType: string, visibility: string | undefined) {
  if (ownerType !== "user" && visibility === "private") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Group docs cannot be private" });
  }
}

const visibilityEnum = z.enum(["private", "group", "public"]);
const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens")
  .max(100);

export const docRouter = router({
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
          eq(artifacts.kind, "doc"),
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

      const [doc] = await ctx.db
        .insert(artifacts)
        .values({
          kind: "doc",
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

      const [version] = await ctx.db
        .insert(artifactVersions)
        .values({
          artifactId: doc.id,
          versionNo: 1,
          body: input.body,
          changelog: input.changelog ?? "Initial version",
          createdBy: userId,
        })
        .returning();

      const [updated] = await ctx.db
        .update(artifacts)
        .set({ currentVersionId: version.id })
        .where(eq(artifacts.id, doc.id))
        .returning();

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

      const baseCondition = input.mine
        ? and(eq(artifacts.ownerType, "user"), eq(artifacts.ownerId, userId))
        : await artifactAccessCondition(userId, systemRole, ctx.db);
      const condition = and(eq(artifacts.kind, "doc"), baseCondition);

      const tagFilter = input.tag
        ? sql`${input.tag} = ANY(${artifacts.tags})`
        : undefined;

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
          with: { versions: { limit: 1, orderBy: desc(artifactVersions.versionNo) } },
        });
        const byId = new Map(found.map((r) => [r.id, r]));
        const items = ids.map((id) => byId.get(id)).filter(Boolean) as typeof found;
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
          with: { versions: { limit: 1, orderBy: desc(artifactVersions.versionNo) } },
        }),
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(artifacts).where(where),
      ]);

      return { items: rows, total: count };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const doc = await ctx.db.query.artifacts.findFirst({
        where: and(eq(artifacts.id, input.id), eq(artifacts.kind, "doc")),
        with: { versions: { orderBy: desc(artifactVersions.versionNo) } },
      });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      const accessible = await canAccessArtifact({ userId, systemRole }, doc, ctx.db);
      if (!accessible) throw new TRPCError({ code: "FORBIDDEN" });

      return doc;
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

      const doc = await ctx.db.query.artifacts.findFirst({
        where: and(eq(artifacts.id, id), eq(artifacts.kind, "doc")),
      });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canMutatePrompt({ userId, systemRole }, doc, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      assertGroupVisibility(doc.ownerType, input.visibility);

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

      const doc = await ctx.db.query.artifacts.findFirst({
        where: and(eq(artifacts.id, input.id), eq(artifacts.kind, "doc")),
      });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canMutatePrompt({ userId, systemRole }, doc, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      await ctx.db.delete(artifacts).where(eq(artifacts.id, input.id));
    }),

  rollback: protectedProcedure
    .input(z.object({ id: z.string().uuid(), toVersionNo: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const doc = await ctx.db.query.artifacts.findFirst({
        where: and(eq(artifacts.id, input.id), eq(artifacts.kind, "doc")),
      });
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canMutatePrompt({ userId, systemRole }, doc, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      const { newVersionNo } = await rollbackVersion(input.id, input.toVersionNo, userId, ctx.db);
      return { newVersionNo };
    }),
});
