import { z } from "zod";
import { eq, and, or, ilike, count, ne, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { users, memberships, artifacts } from "@/server/db/schema";
import { TRPCError } from "@trpc/server";
import { hashPassword } from "@/server/auth/password";
import { recordAudit } from "@/server/services/audit";
import type { DbClient } from "@/server/db/types";
import { usernameSchema } from "@/server/lib/username";

// ── Guards ────────────────────────────────────────────────────────────────────

function requireSuperAdmin(systemRole: string) {
  if (systemRole !== "superadmin") throw new TRPCError({ code: "FORBIDDEN" });
}

async function countOtherSuperAdmins(db: DbClient, excludeUserId: string): Promise<number> {
  const [{ cnt }] = await db
    .select({ cnt: count() })
    .from(users)
    .where(and(eq(users.systemRole, "superadmin"), ne(users.id, excludeUserId)));
  return cnt;
}

export const userRouter = router({
  /**
   * Search users by name or email.
   * Gate: any authenticated user — needed so any artifact owner can find a
   * recipient to share with (canShareArtifact already allows this; search
   * used to be admin-only, which made per-user sharing unusable for regular
   * owners, see D-017 in docs/decisions.md).
   */
  search: protectedProcedure
    .input(
      z.object({
        query: z.string().min(2).max(100),
        limit: z.number().int().min(1).max(20).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const q = `%${input.query}%`;
      return ctx.db
        .select({ id: users.id, name: users.name, username: users.username, email: users.email, image: users.image })
        .from(users)
        .where(or(ilike(users.name, q), ilike(users.username, q), ilike(users.email, q)))
        .limit(input.limit);
    }),

  /**
   * List all users with org count. Superadmin only.
   */
  list: protectedProcedure
    .input(
      z.object({
        query: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireSuperAdmin(ctx.session.systemRole);

      const q = input.query ? `%${input.query}%` : undefined;
      const whereClause = q
        ? or(ilike(users.name, q), ilike(users.username, q), ilike(users.email, q))
        : undefined;

      return ctx.db
        .select({
          id: users.id,
          name: users.name,
          username: users.username,
          email: users.email,
          image: users.image,
          systemRole: users.systemRole,
          hasPassword: sql<boolean>`(${users.passwordHash} is not null)`,
          createdAt: users.createdAt,
          orgCount: count(memberships.id),
        })
        .from(users)
        .leftJoin(
          memberships,
          and(eq(memberships.userId, users.id), eq(memberships.groupType, "org")),
        )
        .where(whereClause)
        .groupBy(users.id)
        .orderBy(users.createdAt)
        .limit(input.limit)
        .offset(input.offset);
    }),

  /**
   * Create a new user. Superadmin only.
   * password optional — null means OAuth-only login.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).optional(),
        username: usernameSchema,
        email: z.string().email(),
        password: z.string().min(8).max(128).optional(),
        systemRole: z.enum(["user", "superadmin"]).default("user"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireSuperAdmin(ctx.session.systemRole);

      const [existingEmail, existingUsername] = await Promise.all([
        ctx.db.query.users.findFirst({ where: eq(users.email, input.email) }),
        ctx.db.query.users.findFirst({ where: eq(users.username, input.username) }),
      ]);
      if (existingEmail) throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
      if (existingUsername) throw new TRPCError({ code: "CONFLICT", message: "Username already in use" });

      const passwordHash = input.password ? await hashPassword(input.password) : null;

      const [user] = await ctx.db
        .insert(users)
        .values({
          name: input.name ?? null,
          username: input.username,
          email: input.email,
          passwordHash,
          systemRole: input.systemRole,
        })
        .returning({ id: users.id, email: users.email, username: users.username, name: users.name });

      return user;
    }),

  /**
   * Update user profile. Superadmin only.
   * removePassword: true clears passwordHash → forces OAuth-only.
   */
  update: protectedProcedure
    .input(
      z
        .object({
          userId: z.string().uuid(),
          name: z.string().min(1).max(100).optional(),
          email: z.string().email().optional(),
          password: z.string().min(8).max(128).optional(),
          removePassword: z.boolean().optional(),
        })
        .strict()
        .refine(
          (d) => !(d.password && d.removePassword),
          { message: "Cannot set password and remove it at the same time" },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      requireSuperAdmin(ctx.session.systemRole);

      const target = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.userId),
      });
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });

      if (input.email && input.email !== target.email) {
        const conflict = await ctx.db.query.users.findFirst({
          where: eq(users.email, input.email),
        });
        if (conflict) throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
      }

      const patch: Partial<typeof users.$inferInsert> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.email !== undefined) patch.email = input.email;
      if (input.password) patch.passwordHash = await hashPassword(input.password);
      if (input.removePassword) patch.passwordHash = null;

      if (Object.keys(patch).length === 0) return target;

      const [updated] = await ctx.db
        .update(users)
        .set(patch)
        .where(eq(users.id, input.userId))
        .returning({ id: users.id, email: users.email, username: users.username, name: users.name });

      return updated;
    }),

  /**
   * Delete a user. Superadmin only.
   * Guards: cannot delete yourself; cannot delete last superadmin.
   * Deletes personal artifacts (ownerType='user') in a transaction.
   */
  delete: protectedProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireSuperAdmin(ctx.session.systemRole);

      if (input.userId === ctx.session.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete your own account" });
      }

      const target = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.userId),
      });
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });

      if (target.systemRole === "superadmin") {
        const otherSuperAdminCount = await countOtherSuperAdmins(ctx.db, input.userId);
        if (otherSuperAdminCount === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot delete the last superadmin",
          });
        }
      }

      await ctx.db.transaction(async (tx) => {
        // Delete personal artifacts + cascade (versions/variables/embeddings have FK cascade)
        const personalPrompts = await tx
          .select({ id: artifacts.id })
          .from(artifacts)
          .where(and(eq(artifacts.ownerType, "user"), eq(artifacts.ownerId, input.userId)));

        for (const p of personalPrompts) {
          await tx.delete(artifacts).where(eq(artifacts.id, p.id));
        }

        // Delete user (memberships cascade via FK)
        await tx.delete(users).where(eq(users.id, input.userId));
      });
    }),

  /**
   * Set system role for a user. Superadmin only.
   * Guard: cannot remove your own superadmin role.
   */
  setSystemRole: protectedProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        role: z.enum(["user", "superadmin"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireSuperAdmin(ctx.session.systemRole);
      if (input.userId === ctx.session.userId && input.role === "user") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove your own superadmin role",
        });
      }
      await ctx.db
        .update(users)
        .set({ systemRole: input.role })
        .where(eq(users.id, input.userId));
      await recordAudit(
        { actorId: ctx.session.userId, action: "user.role", targetType: "user", targetId: input.userId, metadata: { role: input.role } },
        ctx.db,
      );
    }),
});
