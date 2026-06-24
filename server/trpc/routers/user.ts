import { z } from "zod";
import { eq, and, or, ilike, count, ne, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { users, memberships, prompts } from "@/server/db/schema";
import { TRPCError } from "@trpc/server";
import { hashPassword } from "@/server/auth/password";
import type { DbClient } from "@/server/db/types";

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
   * Gate: superadmin OR is admin of at least one org.
   */
  search: protectedProcedure
    .input(
      z.object({
        query: z.string().min(2).max(100),
        limit: z.number().int().min(1).max(20).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      if (systemRole !== "superadmin") {
        const adminMembership = await ctx.db.query.memberships.findFirst({
          where: and(
            eq(memberships.userId, userId),
            eq(memberships.groupType, "org"),
            eq(memberships.role, "admin"),
          ),
        });
        if (!adminMembership) throw new TRPCError({ code: "FORBIDDEN" });
      }
      const q = `%${input.query}%`;
      return ctx.db
        .select({ id: users.id, name: users.name, email: users.email, image: users.image })
        .from(users)
        .where(or(ilike(users.name, q), ilike(users.email, q)))
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
      const whereClause = q ? or(ilike(users.name, q), ilike(users.email, q)) : undefined;

      return ctx.db
        .select({
          id: users.id,
          name: users.name,
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
        email: z.string().email(),
        password: z.string().min(8).max(128).optional(),
        systemRole: z.enum(["user", "superadmin"]).default("user"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireSuperAdmin(ctx.session.systemRole);

      const existing = await ctx.db.query.users.findFirst({
        where: eq(users.email, input.email),
      });
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });

      const passwordHash = input.password ? await hashPassword(input.password) : null;

      const [user] = await ctx.db
        .insert(users)
        .values({
          name: input.name ?? null,
          email: input.email,
          passwordHash,
          systemRole: input.systemRole,
        })
        .returning({ id: users.id, email: users.email, name: users.name });

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
        .returning({ id: users.id, email: users.email, name: users.name });

      return updated;
    }),

  /**
   * Delete a user. Superadmin only.
   * Guards: cannot delete yourself; cannot delete last superadmin.
   * Deletes personal prompts (ownerType='user') in a transaction.
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
        // Delete personal prompts + cascade (versions/variables/embeddings have FK cascade)
        const personalPrompts = await tx
          .select({ id: prompts.id })
          .from(prompts)
          .where(and(eq(prompts.ownerType, "user"), eq(prompts.ownerId, input.userId)));

        for (const p of personalPrompts) {
          await tx.delete(prompts).where(eq(prompts.id, p.id));
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
    }),
});
