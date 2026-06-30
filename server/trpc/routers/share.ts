import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { artifacts, artifactShares, users } from "@/server/db/schema";
import { canShareArtifact } from "@/server/auth/access";

const shareRoleSchema = z.enum(["viewer", "editor"]);

export const shareRouter = router({
  /** List shares for an artifact. Gate: canShareArtifact (owner/admin/superadmin). */
  list: protectedProcedure
    .input(z.object({ artifactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;

      const artifact = await ctx.db.query.artifacts.findFirst({
        where: eq(artifacts.id, input.artifactId),
        columns: { id: true, ownerType: true, ownerId: true },
      });
      if (!artifact) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canShareArtifact({ userId, systemRole }, artifact, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      const rows = await ctx.db.query.artifactShares.findMany({
        where: eq(artifactShares.artifactId, input.artifactId),
        orderBy: desc(artifactShares.createdAt),
        with: {
          user: { columns: { id: true, name: true, email: true, image: true } },
          grantedByUser: { columns: { id: true, name: true } },
        },
      });

      return rows;
    }),

  /** Add or update a share. */
  add: protectedProcedure
    .input(
      z.object({
        artifactId: z.string().uuid(),
        userId: z.string().uuid(),
        role: shareRoleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId: granterId, systemRole } = ctx.session;

      const artifact = await ctx.db.query.artifacts.findFirst({
        where: eq(artifacts.id, input.artifactId),
        columns: { id: true, ownerType: true, ownerId: true },
      });
      if (!artifact) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canShareArtifact({ userId: granterId, systemRole }, artifact, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      // Cannot share with the artifact's own user-owner
      if (artifact.ownerType === "user" && artifact.ownerId === input.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot share with the owner" });
      }

      const [row] = await ctx.db
        .insert(artifactShares)
        .values({
          artifactId: input.artifactId,
          userId: input.userId,
          role: input.role,
          grantedBy: granterId,
        })
        .onConflictDoUpdate({
          target: [artifactShares.artifactId, artifactShares.userId],
          set: { role: input.role, grantedBy: granterId, updatedAt: new Date() },
        })
        .returning();

      return row;
    }),

  /** Update an existing share's role. */
  updateRole: protectedProcedure
    .input(
      z.object({
        artifactId: z.string().uuid(),
        userId: z.string().uuid(),
        role: shareRoleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId: granterId, systemRole } = ctx.session;

      const artifact = await ctx.db.query.artifacts.findFirst({
        where: eq(artifacts.id, input.artifactId),
        columns: { id: true, ownerType: true, ownerId: true },
      });
      if (!artifact) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canShareArtifact({ userId: granterId, systemRole }, artifact, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      const [row] = await ctx.db
        .update(artifactShares)
        .set({ role: input.role, updatedAt: new Date() })
        .where(
          and(
            eq(artifactShares.artifactId, input.artifactId),
            eq(artifactShares.userId, input.userId),
          ),
        )
        .returning();

      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  /** Remove a share. */
  remove: protectedProcedure
    .input(
      z.object({
        artifactId: z.string().uuid(),
        userId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId: granterId, systemRole } = ctx.session;

      const artifact = await ctx.db.query.artifacts.findFirst({
        where: eq(artifacts.id, input.artifactId),
        columns: { id: true, ownerType: true, ownerId: true },
      });
      if (!artifact) throw new TRPCError({ code: "NOT_FOUND" });

      const allowed = await canShareArtifact({ userId: granterId, systemRole }, artifact, ctx.db);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      await ctx.db
        .delete(artifactShares)
        .where(
          and(
            eq(artifactShares.artifactId, input.artifactId),
            eq(artifactShares.userId, input.userId),
          ),
        );
    }),

  /** List all artifacts shared with the current user. */
  listSharedWithMe: protectedProcedure.query(async ({ ctx }) => {
    const { userId } = ctx.session;

    const rows = await ctx.db.query.artifactShares.findMany({
      where: eq(artifactShares.userId, userId),
      orderBy: desc(artifactShares.createdAt),
      with: {
        artifact: {
          columns: {
            id: true,
            kind: true,
            title: true,
            description: true,
            slug: true,
            ownerType: true,
            ownerId: true,
          },
        },
        grantedByUser: { columns: { id: true, name: true, email: true } },
      },
    });

    return rows;
  }),
});
