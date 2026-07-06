import { z } from "zod";
import { desc, eq, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { auditEvents, users } from "@/server/db/schema";

/**
 * Read access to the audit trail. Superadmin-only in v1 (matches
 * /settings/users). Group-scoped views for group admins are a possible
 * follow-up — see plans/46-security-hardening.md §3.
 */
export const auditRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        // Keyset pagination: pass the last row's createdAt to page back in time.
        before: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (ctx.session.systemRole !== "superadmin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const rows = await ctx.db
        .select({
          id: auditEvents.id,
          action: auditEvents.action,
          targetType: auditEvents.targetType,
          targetId: auditEvents.targetId,
          metadata: auditEvents.metadata,
          createdAt: auditEvents.createdAt,
          actorId: auditEvents.actorId,
          actorName: users.name,
          actorEmail: users.email,
        })
        .from(auditEvents)
        .leftJoin(users, eq(auditEvents.actorId, users.id))
        .where(input.before ? lt(auditEvents.createdAt, input.before) : undefined)
        .orderBy(desc(auditEvents.createdAt))
        .limit(input.limit);

      return rows;
    }),
});
