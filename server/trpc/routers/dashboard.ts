import { z } from "zod";
import { DASHBOARD_CARD_IDS } from "@/lib/dashboard-cards";
import {
  getDashboardCardLayout,
  setDashboardCardLayout,
} from "@/server/services/dashboard-preferences";
import { protectedProcedure, router } from "../trpc";

const dashboardCardIdsSchema = z
  .array(z.enum(DASHBOARD_CARD_IDS))
  .max(DASHBOARD_CARD_IDS.length)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Dashboard card IDs must be unique",
  });

export const dashboardRouter = router({
  getLayout: protectedProcedure.query(({ ctx }) =>
    getDashboardCardLayout(ctx.session.userId, ctx.db),
  ),

  updateLayout: protectedProcedure
    .input(z.object({ cardIds: dashboardCardIdsSchema }).strict())
    .mutation(({ ctx, input }) =>
      setDashboardCardLayout(ctx.session.userId, input.cardIds, ctx.db),
    ),
});
