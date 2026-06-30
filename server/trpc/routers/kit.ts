import { z } from "zod";
import { eq, and, or, desc, sql, not, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { artifacts, artifactVersions, artifactMembers } from "@/server/db/schema";
import { artifactAccessCondition, canAccessArtifact, canMutatePrompt, effectiveGroupRole, getAccessibleGroups } from "@/server/auth/access";
import { wouldCreateCycle } from "@/server/lib/kit";
import type { DbClient } from "@/server/db/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function assertGroupVisibility(ownerType: string, visibility: string | undefined) {
  if (ownerType !== "user" && visibility === "private") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Group kits cannot be private",
    });
  }
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const visibilityEnum = z.enum(["private", "group", "public"]);
const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens")
  .max(100);

const memberInputSchema = z.object({
  memberArtifactId: z.string().uuid(),
  position: z.number().int().min(0),
});

// ── Router ────────────────────────────────────────────────────────────────────

export const kitRouter = router({
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
          eq(artifacts.kind, "kit"),
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
        members: z.array(memberInputSchema).default([]),
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

      // Validate members: accessible + no self-ref (kit doesn't exist yet, just check access)
      await validateMembers(userId, systemRole, input.members.map(m => m.memberArtifactId), null, ctx.db);

      const [kit] = await ctx.db
        .insert(artifacts)
        .values({
          kind: "kit",
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
          artifactId: kit.id,
          versionNo: 1,
          body: input.body,
          changelog: input.changelog ?? "Initial version",
          createdBy: userId,
        })
        .returning();

      await ctx.db
        .update(artifacts)
        .set({ currentVersionId: version.id })
        .where(eq(artifacts.id, kit.id));

      if (input.members.length > 0) {
        // Cycle check after kit is created (now we have an id)
        for (const m of input.members) {
          const cycle = await wouldCreateCycle(kit.id, m.memberArtifactId, ctx.db);
          if (cycle) throw new TRPCError({ code: "BAD_REQUEST", message: "Adding this member would create a cycle" });
        }
        await ctx.db.insert(artifactMembers).values(
          input.members.map((m) => ({
            kitArtifactId: kit.id,
            memberArtifactId: m.memberArtifactId,
            position: m.position,
          })),
        );
      }

      return kit;
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

      const baseCondition = input.mine
        ? and(eq(artifacts.ownerType, "user"), eq(artifacts.ownerId, userId))
        : await artifactAccessCondition(userId, systemRole, ctx.db);
      const condition = and(eq(artifacts.kind, "kit"), baseCondition);

      const tagFilter = input.tag ? sql`${input.tag} = ANY(${artifacts.tags})` : undefined;
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
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(artifacts).where(where),
      ]);

      return { items: rows, total: count };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const kit = await ctx.db.query.artifacts.findFirst({
        where: and(eq(artifacts.id, input.id), eq(artifacts.kind, "kit")),
        with: {
          versions: { orderBy: desc(artifactVersions.versionNo) },
          members: {
            orderBy: asc(artifactMembers.position),
          },
        },
      });
      if (!kit) throw new TRPCError({ code: "NOT_FOUND" });

      const accessible = await canAccessArtifact({ userId, systemRole }, kit, ctx.db);
      if (!accessible) throw new TRPCError({ code: "FORBIDDEN" });

      // Resolve member artifact details
      const memberIds = kit.members.map((m) => m.memberArtifactId);
      const memberArtifacts =
        memberIds.length > 0
          ? await ctx.db.query.artifacts.findMany({
              where: and(
                sql`${artifacts.id} = ANY(${memberIds})`,
              ),
              columns: { id: true, kind: true, title: true, slug: true, description: true, ownerType: true, ownerId: true },
            })
          : [];

      const memberById = new Map(memberArtifacts.map((a) => [a.id, a]));
      const resolvedMembers = kit.members
        .map((m) => ({ ...m, artifact: memberById.get(m.memberArtifactId) ?? null }))
        .filter((m) => m.artifact !== null);

      return { ...kit, resolvedMembers };
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
        members: z.array(memberInputSchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const { id, body, changelog, members, ...meta } = input;

      const kit = await ctx.db.query.artifacts.findFirst({
        where: and(eq(artifacts.id, id), eq(artifacts.kind, "kit")),
      });
      if (!kit) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canMutatePrompt({ userId, systemRole }, kit, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      assertGroupVisibility(kit.ownerType, input.visibility);

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

      if (members !== undefined) {
        await validateMembers(userId, systemRole, members.map(m => m.memberArtifactId), id, ctx.db);
        for (const m of members) {
          const cycle = await wouldCreateCycle(id, m.memberArtifactId, ctx.db);
          if (cycle) throw new TRPCError({ code: "BAD_REQUEST", message: "Adding this member would create a cycle" });
        }
        // Replace all members
        await ctx.db.delete(artifactMembers).where(eq(artifactMembers.kitArtifactId, id));
        if (members.length > 0) {
          await ctx.db.insert(artifactMembers).values(
            members.map((m) => ({
              kitArtifactId: id,
              memberArtifactId: m.memberArtifactId,
              position: m.position,
            })),
          );
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

      const kit = await ctx.db.query.artifacts.findFirst({
        where: and(eq(artifacts.id, input.id), eq(artifacts.kind, "kit")),
      });
      if (!kit) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canMutatePrompt({ userId, systemRole }, kit, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      await ctx.db.delete(artifacts).where(eq(artifacts.id, input.id));
    }),

  /** Search artifacts the user can add as kit members. Excludes `excludeKitId` itself. */
  listAddable: protectedProcedure
    .input(
      z.object({
        query: z.string().optional(),
        excludeKitId: z.string().uuid().optional(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const accessClause = await artifactAccessCondition(userId, systemRole, ctx.db);
      const kindFilter = or(
        eq(artifacts.kind, "prompt"),
        eq(artifacts.kind, "skill"),
        eq(artifacts.kind, "kit"),
      );
      const excludeFilter = input.excludeKitId
        ? not(eq(artifacts.id, input.excludeKitId))
        : undefined;
      const ftsFilter = input.query
        ? sql`to_tsvector('english', ${artifacts.title} || ' ' || coalesce(${artifacts.description}, '')) @@ plainto_tsquery('english', ${input.query})`
        : undefined;

      const where = and(kindFilter, accessClause, excludeFilter, ftsFilter);

      const rows = await ctx.db.query.artifacts.findMany({
        where,
        orderBy: desc(artifacts.updatedAt),
        limit: input.limit,
        columns: { id: true, kind: true, title: true, slug: true, description: true, ownerType: true, ownerId: true },
      });

      return rows;
    }),
});

// ── Validation helper ─────────────────────────────────────────────────────────

async function validateMembers(
  userId: string,
  systemRole: "user" | "superadmin",
  memberIds: string[],
  kitId: string | null,
  db: DbClient,
) {
  if (!memberIds.length) return;

  // Check all members exist
  const existing = await db.query.artifacts.findMany({
    where: sql`${artifacts.id} = ANY(${memberIds})`,
    columns: { id: true, visibility: true, ownerType: true, ownerId: true },
  });
  if (existing.length !== memberIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "One or more members not found" });
  }

  // Check self-reference (when kit already exists)
  if (kitId && memberIds.includes(kitId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Kit cannot contain itself" });
  }

  // Check access to each member
  if (systemRole !== "superadmin") {
    const groups = await getAccessibleGroups(userId, db);
    const accessibleGroupSet = new Set(groups.map((g) => `${g.groupType}:${g.groupId}`));

    for (const a of existing) {
      if (a.visibility === "public") continue;
      if (a.ownerType === "user" && a.ownerId === userId) continue;
      if (
        a.visibility === "group" &&
        accessibleGroupSet.has(`${a.ownerType}:${a.ownerId}`)
      ) continue;
      throw new TRPCError({ code: "FORBIDDEN", message: "No access to one or more members" });
    }
  }
}
