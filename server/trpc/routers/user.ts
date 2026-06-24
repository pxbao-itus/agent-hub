import { z } from "zod";
import { eq, and, or, ilike, count } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { users, memberships } from "@/server/db/schema";
import { TRPCError } from "@trpc/server";

export const userRouter = router({
  /**
   * Search users by name or email.
   * Gate: superadmin OR is admin of at least one org.
   * Returns minimal fields only (id/name/email/image).
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
      if (ctx.session.systemRole !== "superadmin") throw new TRPCError({ code: "FORBIDDEN" });

      const q = input.query ? `%${input.query}%` : undefined;
      const whereClause = q ? or(ilike(users.name, q), ilike(users.email, q)) : undefined;

      const rows = await ctx.db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
          systemRole: users.systemRole,
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

      return rows;
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
      if (ctx.session.systemRole !== "superadmin") throw new TRPCError({ code: "FORBIDDEN" });
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
