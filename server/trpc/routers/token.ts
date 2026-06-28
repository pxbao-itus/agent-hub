import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { mcpTokens } from "@/server/db/schema";
import { generateRawToken, hashToken, tokenPrefix } from "@/server/mcp/token";
import { tokenScopeSchema, validateScopeAgainstAccess } from "@/server/mcp/scope";
import { getAccessibleGroups } from "@/server/auth/access";

export const tokenRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        expiresInDays: z.number().min(1).max(365).optional(),
        scope: tokenScopeSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate scope doesn't exceed user's access
      if (input.scope?.spaces?.length) {
        const accessibleGroups = await getAccessibleGroups(ctx.session.userId, ctx.db);
        if (!validateScopeAgainstAccess(input.scope, accessibleGroups)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Scope includes spaces you cannot access" });
        }
      }

      const raw = generateRawToken();
      const hash = hashToken(raw);
      const prefix = tokenPrefix(raw);

      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null;

      const [token] = await ctx.db
        .insert(mcpTokens)
        .values({
          userId: ctx.session.userId,
          name: input.name,
          tokenHash: hash,
          tokenPrefix: prefix,
          expiresAt: expiresAt ?? undefined,
          scope: input.scope ?? null,
        })
        .returning();

      // Return the raw token ONCE — never stored again
      return { ...token, rawToken: raw };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.mcpTokens.findMany({
      where: eq(mcpTokens.userId, ctx.session.userId),
      orderBy: desc(mcpTokens.createdAt),
      columns: {
        id: true,
        name: true,
        tokenPrefix: true,
        scope: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  }),

  revoke: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const token = await ctx.db.query.mcpTokens.findFirst({
        where: and(
          eq(mcpTokens.id, input.id),
          eq(mcpTokens.userId, ctx.session.userId),
        ),
      });
      if (!token) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.delete(mcpTokens).where(eq(mcpTokens.id, input.id));
    }),
});
